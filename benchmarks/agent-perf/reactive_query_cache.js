/**
 * Reactive Query Cache with LRU eviction, TTL + Stale-While-Revalidate,
 * in-flight promise coalescing, and dependency-tag invalidation.
 */
export class ReactiveQueryCache {
  constructor({ maxEntries = 100, defaultTtlMs = 5000, staleWhileRevalidateMs = 2000, now = () => Date.now() } = {}) {
    if (maxEntries < 1) throw new RangeError("maxEntries must be >= 1");
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
    this.staleWhileRevalidateMs = staleWhileRevalidateMs;
    this.now = now;

    this.entries = new Map();
    this.inFlight = new Map();
    this.tagIndex = new Map();
    this.listeners = new Map();
  }

  async query(key, fetcher, options = {}) {
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    const swrMs = options.staleWhileRevalidateMs ?? this.staleWhileRevalidateMs;
    const tags = options.tags ?? [];
    const currentTime = this.now();

    const existing = this.entries.get(key);
    if (existing) {
      this._touchLru(key, existing);
      const age = currentTime - existing.updatedAt;
      if (age <= existing.ttlMs) {
        return existing.value;
      }
      if (age <= existing.ttlMs + existing.swrMs) {
        this._revalidateInBackground(key, fetcher, { ttlMs, swrMs, tags });
        return existing.value;
      }
    }

    return this._coalescedFetch(key, fetcher, { ttlMs, swrMs, tags });
  }

  invalidateByTag(tag) {
    const keys = this.tagIndex.get(tag);
    if (!keys) return 0;
    let count = 0;
    for (const key of [...keys]) {
      if (this.delete(key)) count += 1;
    }
    this.tagIndex.delete(tag);
    return count;
  }

  delete(key) {
    const existing = this.entries.get(key);
    if (!existing) return false;
    this.entries.delete(key);
    for (const tag of existing.tags) {
      const set = this.tagIndex.get(tag);
      if (set) {
        set.delete(key);
        if (set.size === 0) this.tagIndex.delete(tag);
      }
    }
    this._notify(key, { type: "invalidated", key });
    return true;
  }

  subscribe(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    const subs = this.listeners.get(key);
    subs.add(callback);
    return () => {
      subs.delete(callback);
      if (subs.size === 0) this.listeners.delete(key);
    };
  }

  _revalidateInBackground(key, fetcher, meta) {
    if (this.inFlight.has(key)) return;
    this._coalescedFetch(key, fetcher, meta).catch(() => {
      // Background revalidation errors are swallowed to preserve stale value
    });
  }

  _coalescedFetch(key, fetcher, meta) {
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key);
    }
    const promise = Promise.resolve()
      .then(() => fetcher(key))
      .then((value) => {
        this._set(key, value, meta);
        this.inFlight.delete(key);
        return value;
      })
      .catch((err) => {
        this.inFlight.delete(key);
        this._notify(key, { type: "error", key, error: err });
        throw err;
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  _set(key, value, { ttlMs, swrMs, tags }) {
    if (this.entries.has(key)) {
      this.delete(key);
    } else if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      this.delete(oldestKey);
    }

    const entry = {
      value,
      updatedAt: this.now(),
      ttlMs,
      swrMs,
      tags: [...tags],
    };
    this.entries.set(key, entry);
    for (const tag of entry.tags) {
      if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
      this.tagIndex.get(tag).add(key);
    }
    this._notify(key, { type: "updated", key, value });
  }

  _touchLru(key, entry) {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  _notify(key, event) {
    const subs = this.listeners.get(key);
    if (!subs) return;
    for (const cb of [...subs]) {
      cb(event);
    }
  }
}
