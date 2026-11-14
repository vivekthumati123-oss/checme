from __future__ import annotations

import dataclasses
import time
from typing import Any

from agent_core.binding import AgentBinding
from agent_core.contracts import AgentMetrics, AgentRequest, AgentResult
from agent_core.prompt_composer import PromptComposer


class _TrackedRuntime:
    def __init__(self, runtime: Any, binding: AgentBinding, models: list[str]) -> None:
        self._runtime, self._binding, self._models = runtime, binding, models
        self.calls = getattr(runtime, "calls", None)

    async def run(self, options: Any) -> Any:
        if getattr(options, "model", None) is None:
            options = dataclasses.replace(options, model=self._binding.model)
        if not getattr(options, "tools", None):
            options = dataclasses.replace(options, tools=self._binding.tools)
        response = await self._runtime.run(options)
        model = getattr(response, "model", None) or options.model or "sdk-default"
        if model not in self._models:
            self._models.append(model)
        return response


class BaseAgent:
    def __init__(self, binding: AgentBinding) -> None:
        if binding is None:
            raise ValueError("An AgentBinding (l2/<id>.json) is required")
        self.binding = binding

    @property
    def id(self) -> str:
        return self.binding.id

    def compose_prompt(self, target_paths: list[str] | None = None) -> PromptComposer:
        budget = self.binding.resolve_config().get("promptBudgetChars", 60000)
        return PromptComposer(self.binding, budget).add_instructions_for(target_paths).add_agent().add_skills()

    async def validate(self, request: AgentRequest) -> None:
        return None

    async def perform(self, request: AgentRequest, context: Any) -> AgentResult:
        raise NotImplementedError(f"{self.id}: perform() is not implemented")

    async def execute(self, request: AgentRequest, context: Any) -> AgentResult:
        started = time.perf_counter()
        models: list[str] = []
        context = dataclasses.replace(context, runtime=_TrackedRuntime(context.runtime, self.binding, models))
        hooks = getattr(context, "hooks", None)
        hook_context = {"agentId": self.id, "requestId": request.request_id}
        model_used = lambda: ",".join(models) or None
        context.logger.info("agent.started", agentId=self.id, requestId=request.request_id, model=self.binding.model or "sdk-default")
        if hooks:
            hooks.run("sessionStart", {**hook_context, "initialPrompt": self.id})
        try:
            await self.validate(request)
            result = await self.perform(request, context)
            result.metrics.duration_ms = int((time.perf_counter() - started) * 1000)
            result.metrics.model = model_used()
            context.logger.info("agent.completed", agentId=self.id, status=result.status, model=result.metrics.model)
            if hooks:
                hooks.run("sessionEnd", {**hook_context, "reason": result.status, "model": result.metrics.model})
            return result
        except Exception as error:
            context.logger.error("agent.failed", agentId=self.id, error=str(error))
            if hooks:
                hooks.run("errorOccurred", {**hook_context, "error": {"name": type(error).__name__, "message": str(error)}})
                hooks.run("sessionEnd", {**hook_context, "reason": "failed", "model": model_used()})
            return AgentResult(request_id=request.request_id, agent_id=self.id, status="failed", summary=str(error), warnings=[getattr(error, "code", "AGENT_ERROR")],
                               metrics=AgentMetrics(duration_ms=int((time.perf_counter() - started) * 1000), model=model_used()))
