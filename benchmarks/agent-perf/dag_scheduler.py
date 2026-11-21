"""Complex DAG Task Scheduler with critical-path priority and retry state machine."""

from __future__ import annotations

import heapq
from collections import defaultdict, deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, List, Optional, Set, Tuple


class TaskState(Enum):
    PENDING = "pending"
    READY = "ready"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"


class CycleDetectedError(ValueError):
    """Raised when the task dependency graph contains a cycle."""

    def __init__(self, cycle_path: List[str]) -> None:
        self.cycle_path = cycle_path
        super().__init__(f"Dependency cycle detected: {' -> '.join(cycle_path)}")


@dataclass
class TaskSpec:
    task_id: str
    duration: float
    dependencies: Set[str] = field(default_factory=set)
    max_retries: int = 0
    priority_boost: float = 0.0
    handler: Optional[Callable[[str, int], bool]] = None


@dataclass
class TaskRuntime:
    spec: TaskSpec
    state: TaskState = TaskState.PENDING
    attempts: int = 0
    critical_path_weight: float = 0.0
    error_message: Optional[str] = None


class DagScheduler:
    """Schedules and simulates execution of a DAG of tasks with bounded concurrency."""

    def __init__(self, max_concurrency: int = 2) -> None:
        if max_concurrency < 1:
            raise ValueError("max_concurrency must be at least 1")
        self.max_concurrency = max_concurrency
        self._tasks: Dict[str, TaskRuntime] = {}
        self._dependents: Dict[str, Set[str]] = defaultdict(set)

    def add_task(self, spec: TaskSpec) -> None:
        if spec.task_id in self._tasks:
            raise ValueError(f"Duplicate task_id: {spec.task_id}")
        if spec.duration < 0:
            raise ValueError(f"Negative duration for {spec.task_id}")
        self._tasks[spec.task_id] = TaskRuntime(spec=spec)
        for dep in spec.dependencies:
            self._dependents[dep].add(spec.task_id)

    def validate_and_compute_weights(self) -> List[str]:
        """Validates missing dependencies, detects cycles, and computes critical-path weights."""
        for task_id, rt in self._tasks.items():
            missing = rt.spec.dependencies - self._tasks.keys()
            if missing:
                raise KeyError(f"Task '{task_id}' has unknown dependencies: {sorted(missing)}")

        in_degree: Dict[str, int] = {
            tid: len(rt.spec.dependencies) for tid, rt in self._tasks.items()
        }
        queue = deque(tid for tid, deg in in_degree.items() if deg == 0)
        topo_order: List[str] = []

        while queue:
            current = queue.popleft()
            topo_order.append(current)
            for dependent in self._dependents[current]:
                in_degree[dependent] -= 1
                if in_degree[dependent] == 0:
                    queue.append(dependent)

        if len(topo_order) != len(self._tasks):
            cycle = self._find_cycle()
            raise CycleDetectedError(cycle)

        # Bottom-up critical path weight calculation
        for tid in reversed(topo_order):
            rt = self._tasks[tid]
            max_child_weight = max(
                (self._tasks[child].critical_path_weight for child in self._dependents[tid]),
                default=0.0,
            )
            rt.critical_path_weight = rt.spec.duration + rt.spec.priority_boost + max_child_weight

        return topo_order

    def _find_cycle(self) -> List[str]:
        white, gray, black = 0, 1, 2
        color: Dict[str, int] = {tid: white for tid in self._tasks}
        parent: Dict[str, Optional[str]] = {}

        def dfs(node: str) -> Optional[List[str]]:
            color[node] = gray
            for nxt in self._dependents[node]:
                if color[nxt] == gray:
                    path = [nxt, node]
                    cur = node
                    while cur in parent and parent[cur] is not None and cur != nxt:
                        cur = parent[cur]
                        path.append(cur)
                        if cur == nxt:
                            break
                    return list(reversed(path))
                if color[nxt] == white:
                    parent[nxt] = node
                    res = dfs(nxt)
                    if res:
                        return res
            color[node] = black
            return None

        for tid in self._tasks:
            if color[tid] == white:
                parent[tid] = None
                res = dfs(tid)
                if res:
                    return res
        return []

    def run(self) -> Dict[str, TaskState]:
        """Executes all tasks in priority order respecting dependencies and retries."""
        self.validate_and_compute_weights()
        remaining_deps: Dict[str, int] = {
            tid: len(rt.spec.dependencies) for tid, rt in self._tasks.items()
        }

        ready_heap: List[Tuple[float, str]] = []
        for tid, deg in remaining_deps.items():
            if deg == 0:
                self._tasks[tid].state = TaskState.READY
                heapq.heappush(ready_heap, (-self._tasks[tid].critical_path_weight, tid))

        while ready_heap:
            batch: List[str] = []
            while ready_heap and len(batch) < self.max_concurrency:
                _, tid = heapq.heappop(ready_heap)
                batch.append(tid)

            for tid in batch:
                rt = self._tasks[tid]
                rt.state = TaskState.RUNNING
                rt.attempts += 1
                success = True
                if rt.spec.handler is not None:
                    try:
                        success = bool(rt.spec.handler(tid, rt.attempts))
                    except Exception as exc:
                        rt.error_message = str(exc)
                        success = False

                if success:
                    rt.state = TaskState.SUCCEEDED
                    for dep_tid in self._dependents[tid]:
                        remaining_deps[dep_tid] -= 1
                        if remaining_deps[dep_tid] == 0:
                            dep_rt = self._tasks[dep_tid]
                            dep_rt.state = TaskState.READY
                            heapq.heappush(ready_heap, (-dep_rt.critical_path_weight, dep_tid))
                elif rt.attempts <= rt.spec.max_retries:
                    rt.state = TaskState.READY
                    heapq.heappush(ready_heap, (-rt.critical_path_weight, tid))
                else:
                    rt.state = TaskState.FAILED
                    self._skip_downstream(tid)

        return {tid: rt.state for tid, rt in self._tasks.items()}

    def _skip_downstream(self, failed_tid: str) -> None:
        queue = deque(self._dependents[failed_tid])
        while queue:
            tid = queue.popleft()
            rt = self._tasks[tid]
            if rt.state in (TaskState.PENDING, TaskState.READY):
                rt.state = TaskState.SKIPPED
                queue.extend(self._dependents[tid])
