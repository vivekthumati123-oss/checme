package benchmarks.agentperf;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.NavigableMap;
import java.util.Objects;
import java.util.TreeMap;
import java.util.concurrent.locks.ReadWriteLock;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * Thread-safe Consistent Hashing Ring with virtual nodes, weighted capacity,
 * and bounded-load key routing.
 */
public class ConsistentHashRing {

    public static final class Node {
        private final String id;
        private final int weight;

        public Node(String id, int weight) {
            if (id == null || id.isBlank()) {
                throw new IllegalArgumentException("Node id must be non-blank");
            }
            if (weight < 1) {
                throw new IllegalArgumentException("Node weight must be >= 1");
            }
            this.id = id;
            this.weight = weight;
        }

        public String getId() {
            return id;
        }

        public int getWeight() {
            return weight;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof Node other)) return false;
            return Objects.equals(id, other.id);
        }

        @Override
        public int hashCode() {
            return Objects.hash(id);
        }
    }

    private final int virtualNodesPerWeight;
    private final double loadFactor;
    private final NavigableMap<Long, Node> ring = new TreeMap<>();
    private final Map<String, Node> nodes = new HashMap<>();
    private final Map<String, Integer> activeLoads = new HashMap<>();
    private final ReadWriteLock lock = new ReentrantReadWriteLock();
    private long totalLoad = 0;

    public ConsistentHashRing(int virtualNodesPerWeight, double loadFactor) {
        if (virtualNodesPerWeight < 1) {
            throw new IllegalArgumentException("virtualNodesPerWeight must be >= 1");
        }
        if (loadFactor < 1.0) {
            throw new IllegalArgumentException("loadFactor must be >= 1.0");
        }
        this.virtualNodesPerWeight = virtualNodesPerWeight;
        this.loadFactor = loadFactor;
    }

    public void addNode(Node node) {
        Objects.requireNonNull(node, "node must not be null");
        lock.writeLock().lock();
        try {
            if (nodes.containsKey(node.getId())) {
                removeNodeInternal(node.getId());
            }
            nodes.put(node.getId(), node);
            activeLoads.putIfAbsent(node.getId(), 0);
            int replicas = node.getWeight() * virtualNodesPerWeight;
            for (int i = 0; i < replicas; i++) {
                long hash = hash64(node.getId() + "#" + i);
                ring.put(hash, node);
            }
        } finally {
            lock.writeLock().unlock();
        }
    }

    public boolean removeNode(String nodeId) {
        lock.writeLock().lock();
        try {
            return removeNodeInternal(nodeId);
        } finally {
            lock.writeLock().unlock();
        }
    }

    private boolean removeNodeInternal(String nodeId) {
        Node removed = nodes.remove(nodeId);
        if (removed == null) {
            return false;
        }
        Integer load = activeLoads.remove(nodeId);
        if (load != null) {
            totalLoad = Math.max(0, totalLoad - load);
        }
        int replicas = removed.getWeight() * virtualNodesPerWeight;
        for (int i = 0; i < replicas; i++) {
            long hash = hash64(removed.getId() + "#" + i);
            ring.remove(hash);
        }
        return true;
    }

    public Node routeKey(String key) {
        if (key == null) {
            throw new IllegalArgumentException("key must not be null");
        }
        lock.readLock().lock();
        try {
            if (ring.isEmpty()) {
                throw new IllegalStateException("Hash ring is empty");
            }
            long hash = hash64(key);
            Map.Entry<Long, Node> entry = ring.ceilingEntry(hash);
            if (entry == null) {
                entry = ring.firstEntry();
            }

            long maxAllowed = (long) Math.ceil(((double) (totalLoad + 1) / nodes.size()) * loadFactor);
            Node candidate = entry.getValue();
            if (activeLoads.getOrDefault(candidate.getId(), 0) < maxAllowed) {
                return candidate;
            }

            // Bounded-load linear probe around the ring
            Long cursor = entry.getKey();
            for (int visited = 0; visited < ring.size(); visited++) {
                Map.Entry<Long, Node> next = ring.higherEntry(cursor);
                if (next == null) {
                    next = ring.firstEntry();
                }
                cursor = next.getKey();
                Node nextNode = next.getValue();
                if (activeLoads.getOrDefault(nextNode.getId(), 0) < maxAllowed) {
                    return nextNode;
                }
            }
            return candidate;
        } finally {
            lock.readLock().unlock();
        }
    }

    public void recordLoad(String nodeId, int delta) {
        lock.writeLock().lock();
        try {
            if (!nodes.containsKey(nodeId)) {
                throw new IllegalArgumentException("Unknown node: " + nodeId);
            }
            int current = activeLoads.getOrDefault(nodeId, 0);
            int updated = Math.max(0, current + delta);
            totalLoad += (updated - current);
            activeLoads.put(nodeId, updated);
        } finally {
            lock.writeLock().unlock();
        }
    }

    public List<Node> getReplicationTargets(String key, int replicationFactor) {
        if (replicationFactor < 1) {
            throw new IllegalArgumentException("replicationFactor must be >= 1");
        }
        lock.readLock().lock();
        try {
            if (ring.isEmpty()) {
                return Collections.emptyList();
            }
            int targetCount = Math.min(replicationFactor, nodes.size());
            List<Node> targets = new ArrayList<>(targetCount);
            Long cursor = hash64(key);

            while (targets.size() < targetCount) {
                Map.Entry<Long, Node> entry = ring.ceilingEntry(cursor);
                if (entry == null) {
                    entry = ring.firstEntry();
                }
                Node node = entry.getValue();
                if (!targets.contains(node)) {
                    targets.add(node);
                }
                cursor = entry.getKey() + 1;
            }
            return targets;
        } finally {
            lock.readLock().unlock();
        }
    }

    private static long hash64(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(input.getBytes(StandardCharsets.UTF_8));
            long value = 0;
            for (int i = 0; i < 8; i++) {
                value = (value << 8) | (digest[i] & 0xffL);
            }
            return value;
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
