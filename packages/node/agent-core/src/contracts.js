import { randomUUID } from "node:crypto";

export const AUTOMATION_MODE = "automation";

/** Serialises a model request in automation mode (agents return JSON only when they see it). */
export function automationTask(task) {
  return JSON.stringify({ mode: AUTOMATION_MODE, ...task }, null, 2);
}

export function createAgentRequest(input) {
  return {
    requestId: input.requestId ?? randomUUID(),
    agentId: input.agentId,
    correlationId: input.correlationId ?? randomUUID(),
    trigger: input.trigger ?? { type: "manual", provider: "internal", eventName: "manual" },
    actor: input.actor ?? { id: "local", login: "local", type: "user" },
    repository: input.repository,
    payload: input.payload ?? {},
    dryRun: input.dryRun ?? false,
    requestedAt: input.requestedAt ?? new Date().toISOString(),
  };
}

export function createAgentResult(request, overrides = {}) {
  return {
    requestId: request.requestId,
    agentId: request.agentId,
    status: "succeeded",
    summary: "",
    data: null,
    artifacts: [],
    warnings: [],
    completedAt: new Date().toISOString(),
    ...overrides,
    metrics: { durationMs: 0, model: null, ...(overrides.metrics ?? {}) },
  };
}

export class AgentError extends Error {
  constructor(message, { code = "AGENT_ERROR", retryable = false } = {}) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.retryable = retryable;
  }
}

export class PolicyViolationError extends AgentError {
  constructor(message) {
    super(message, { code: "POLICY_VIOLATION" });
    this.name = "PolicyViolationError";
  }
}
