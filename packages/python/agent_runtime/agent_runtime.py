"""Model access for Python agents. Mock for offline runs, Copilot SDK for real runs."""

from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


@dataclass
class AgentRunOptions:
    system_prompt: str
    user_prompt: str
    working_directory: str
    agent_id: str = "unknown"
    model: str | None = None
    tools: list[str] = field(default_factory=list)
    timeout_seconds: int = 900


@dataclass
class AgentRunResponse:
    content: str
    structured_output: Any = None
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None


def parse_structured_output(content: str) -> Any:
    text = (content or "").strip()
    if not text:
        return None
    match = _FENCE.search(text)
    candidate = (match.group(1) if match else text).strip()
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        start, end = candidate.find("{"), candidate.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(candidate[start:end + 1])
            except json.JSONDecodeError:
                return None
    return None


class AgentRuntime:
    async def run(self, options: AgentRunOptions) -> AgentRunResponse:
        raise NotImplementedError


class MockAgentRuntime(AgentRuntime):
    def __init__(self, handlers: dict[str, Callable[[AgentRunOptions], Awaitable[Any]]] | None = None) -> None:
        self.handlers = handlers or {}
        self.calls: list[AgentRunOptions] = []

    async def run(self, options: AgentRunOptions) -> AgentRunResponse:
        self.calls.append(options)
        handler = self.handlers.get(options.agent_id) or self.handlers.get("default")
        output = await handler(options) if handler else {"summary": "mock runtime: no handler registered"}
        return AgentRunResponse(content=json.dumps(output, default=str), structured_output=output, model=f"mock:{options.model or 'sdk-default'}",
                                input_tokens=len(options.system_prompt + options.user_prompt) // 4, output_tokens=len(json.dumps(output, default=str)) // 4)


class CopilotAgentRuntime(AgentRuntime):
    """Backed by `github-copilot-sdk`, imported lazily. Model: options.model -> L2_DEFAULT_MODEL -> SDK default."""

    def __init__(self, default_model: str | None = None) -> None:
        self.default_model = default_model or os.environ.get("L2_DEFAULT_MODEL") or None

    async def run(self, options: AgentRunOptions) -> AgentRunResponse:
        try:
            from copilot import CopilotClient
            from copilot.session import PermissionHandler
            from copilot.session_events import AssistantMessageData, SessionIdleData
        except ImportError as error:
            raise RuntimeError("github-copilot-sdk is not installed. Use AGENT_RUNTIME=mock for offline runs.") from error
        model = options.model or self.default_model
        content = ""
        idle = asyncio.Event()
        session_args: dict[str, Any] = {"on_permission_request": PermissionHandler.approve_all}
        if model:
            session_args["model"] = model
        async with CopilotClient() as client:
            async with await client.create_session(**session_args) as session:

                def on_event(event: Any) -> None:
                    nonlocal content
                    if isinstance(event.data, AssistantMessageData):
                        content += event.data.content
                    elif isinstance(event.data, SessionIdleData):
                        idle.set()

                session.on(on_event)
                await session.send(f"{options.system_prompt}\n\n# Task\n\n{options.user_prompt}")
                await asyncio.wait_for(idle.wait(), timeout=options.timeout_seconds)
        return AgentRunResponse(content=content, structured_output=parse_structured_output(content), model=model or "sdk-default")
