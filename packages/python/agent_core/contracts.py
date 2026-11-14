"""Shared agent contracts. Mirrors packages/node/agent-core/src/contracts.js."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

AgentStatus = Literal["succeeded", "failed", "skipped", "requires_approval"]
AUTOMATION_MODE = "automation"


def automation_task(task: dict[str, Any]) -> str:
    return json.dumps({"mode": AUTOMATION_MODE, **task}, indent=2, default=str)


@dataclass(frozen=True)
class TriggerContext:
    type: str
    provider: str
    event_name: str
    event_action: str | None = None


@dataclass(frozen=True)
class RepositoryContext:
    provider: str
    owner: str
    name: str
    default_branch: str
    working_directory: str
    pull_request_number: int | None = None
    base_sha: str | None = None
    head_sha: str | None = None


@dataclass(frozen=True)
class ActorContext:
    id: str
    login: str
    type: str = "user"


@dataclass
class AgentRequest:
    agent_id: str
    trigger: TriggerContext
    actor: ActorContext
    payload: dict[str, Any] = field(default_factory=dict)
    repository: RepositoryContext | None = None
    dry_run: bool = False
    request_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    correlation_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    requested_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class AgentArtifact:
    type: str
    name: str
    path: str | None = None
    url: str | None = None


@dataclass
class AgentMetrics:
    duration_ms: int = 0
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None


@dataclass
class AgentResult:
    request_id: str
    agent_id: str
    status: AgentStatus = "succeeded"
    summary: str = ""
    data: Any = None
    artifacts: list[AgentArtifact] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    metrics: AgentMetrics = field(default_factory=AgentMetrics)
    completed_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class AgentError(Exception):
    def __init__(self, message: str, code: str = "AGENT_ERROR") -> None:
        super().__init__(message)
        self.code = code


class PolicyViolationError(AgentError):
    def __init__(self, message: str) -> None:
        super().__init__(message, code="POLICY_VIOLATION")
