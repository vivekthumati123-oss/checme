import { Logger, Telemetry, PolicyEngine, HookRunner } from "@l2/agent-core";
import { GitHubScmProvider } from "@l2/github-adapter";
import { CopilotAgentRuntime, MockAgentRuntime } from "@l2/copilot-runtime";
import { WorkItemRouter, loadEnvFile } from "@l2/work-items";

/** Build everything an agent needs from its binding. Agents never construct clients themselves. */
export async function buildExecutionContext(request, binding, overrides = {}) {
  loadEnvFile({ start: binding.root });
  const logger = overrides.logger ?? new Logger({ agentId: request.agentId, correlationId: request.correlationId, level: process.env.LOG_LEVEL ?? "info" });
  const hooks = overrides.hooks !== undefined
    ? overrides.hooks
    : await HookRunner.load(binding.root, { names: binding.hookNames, logger, context: { agentId: binding.id, requestId: request.requestId } });
  return {
    logger,
    telemetry: new Telemetry(logger),
    policy: new PolicyEngine(binding.policy),
    hooks,
    scm: overrides.scm !== undefined ? overrides.scm : buildScm(request, logger),
    workItems: overrides.workItems !== undefined ? overrides.workItems : buildWorkItems(request, binding),
    runtime: overrides.runtime ?? buildRuntime(logger, overrides.mockHandlers),
    workspace: request.repository?.workingDirectory ?? binding.root,
  };
}

function buildRuntime(logger, mockHandlers) {
  return (process.env.AGENT_RUNTIME ?? "mock") === "copilot" ? new CopilotAgentRuntime({ logger }) : new MockAgentRuntime({ handlers: mockHandlers ?? {} });
}

function buildScm(request, logger) {
  if (!request.repository) return null;
  return new GitHubScmProvider({ owner: request.repository.owner, repo: request.repository.name, logger, dryRun: request.dryRun });
}

/**
 * Real work item access (GitHub Issues, Jira, Azure DevOps). References carry their system
 * (ado:123, jira:PROJ-1, github:#12); bare ids use WORK_ITEM_PROVIDER or the binding's config.
 */
function buildWorkItems(request, binding) {
  const repo = request.repository ? `${request.repository.owner}/${request.repository.name}` : undefined;
  const defaultProvider = process.env.WORK_ITEM_PROVIDER ?? binding.resolveConfig().workItemProvider;
  return new WorkItemRouter({ env: process.env, defaultProvider, defaultRepo: process.env.WORK_ITEMS_GITHUB_REPO ?? repo });
}
