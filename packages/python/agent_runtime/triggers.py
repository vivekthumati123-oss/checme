from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from agent_core.contracts import ActorContext, AgentRequest, RepositoryContext, TriggerContext


def load_event() -> dict[str, Any]:
    path = os.environ.get("GITHUB_EVENT_PATH") or os.environ.get("EVENT_FILE")
    if not path:
        raise RuntimeError("Set GITHUB_EVENT_PATH (Actions) or EVENT_FILE (local)")
    return json.loads(Path(path).read_text(encoding="utf-8"))


def from_github_event(event: dict[str, Any], agent_id: str, payload: dict[str, Any], working_directory: str) -> AgentRequest:
    repository = event.get("repository")
    pr = event.get("pull_request") or {}
    sender = event.get("sender") or {}
    event_name = os.environ.get("GITHUB_EVENT_NAME", "workflow_dispatch")
    return AgentRequest(
        agent_id=agent_id, correlation_id=os.environ.get("GITHUB_RUN_ID", ""), dry_run=os.environ.get("AGENT_DRY_RUN") == "true",
        trigger=TriggerContext("pull_request" if pr else ("schedule" if event_name == "schedule" else "manual"), "github", event_name, event.get("action")),
        actor=ActorContext(str(sender.get("id", "local")), sender.get("login", os.environ.get("GITHUB_ACTOR", "local"))),
        repository=RepositoryContext("github", (repository.get("owner") or {}).get("login", ""), repository.get("name", ""), repository.get("default_branch", "main"),
                                     working_directory, pr.get("number"), (pr.get("base") or {}).get("sha"), (pr.get("head") or {}).get("sha")) if repository else None,
        payload=payload,
    )
