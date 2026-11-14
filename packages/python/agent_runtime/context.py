from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from agent_core import AgentBinding, HookRunner, Logger, PolicyEngine
from agent_core.contracts import AgentRequest

from agent_runtime.agent_runtime import AgentRuntime, CopilotAgentRuntime, MockAgentRuntime


@dataclass
class AgentExecutionContext:
    logger: Logger
    policy: PolicyEngine
    runtime: AgentRuntime
    workspace: str
    hooks: HookRunner | None = None
    scm: Any = None
    work_items: Any = None


def build_execution_context(request: AgentRequest, binding: AgentBinding, runtime: AgentRuntime | None = None,
                            hooks: HookRunner | None | bool = True, mock_handlers: dict[str, Any] | None = None) -> AgentExecutionContext:
    logger = Logger(request.agent_id, request.correlation_id, os.environ.get("LOG_LEVEL", "info"))
    if runtime is None:
        runtime = CopilotAgentRuntime() if os.environ.get("AGENT_RUNTIME") == "copilot" else MockAgentRuntime(mock_handlers)
    if hooks is True:
        hooks = HookRunner.load(binding.root, binding.hook_names, logger, {"agentId": binding.id, "requestId": request.request_id})
    return AgentExecutionContext(logger=logger, policy=PolicyEngine(binding.policy), runtime=runtime, workspace=str(binding.root), hooks=hooks or None)
