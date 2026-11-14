from __future__ import annotations

import dataclasses
import json
import os
import sys
from pathlib import Path
from typing import Any, Callable

from agent_core import AgentBinding, load_binding, repo_root
from agent_core.contracts import AgentResult

from agent_runtime.context import build_execution_context
from agent_runtime.triggers import from_github_event, load_event


async def run_agent(binding_id: str, create_agent: Callable[[AgentBinding], Any], payload: dict[str, Any] | None = None, **overrides: Any) -> AgentResult:
    binding = load_binding(binding_id, repo_root())
    if binding.status == "planned":
        raise RuntimeError(f"Agent {binding_id} is planned and has no runnable implementation yet")
    agent = create_agent(binding)
    request = from_github_event(load_event(), agent.id, binding.resolve_config(payload), str(binding.root))
    context = build_execution_context(request, binding, **overrides)
    result = await agent.execute(request, context)
    print(json.dumps(dataclasses.asdict(result), indent=2, default=str))
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with Path(path).open("a", encoding="utf-8") as handle:
            handle.write(f"## {binding.display_name}\n\n**Status:** {result.status} · **Model:** {result.metrics.model or 'none'}\n\n{result.summary}\n")
    if result.status == "failed":
        sys.exit(1)
    return result
