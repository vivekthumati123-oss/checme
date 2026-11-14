import { createAgentResult } from "./contracts.js";
import { PromptComposer } from "./prompt-composer.js";

/**
 * Lifecycle: sessionStart hook -> validate -> perform -> sessionEnd hook (errorOccurred on failure).
 * Fills each model call with the binding's model and records the model used in result.metrics.model.
 */
export class BaseAgent {
  constructor(binding) {
    if (!binding?.agent) throw new Error("An AgentBinding (l2/<id>.json) is required");
    this.binding = binding;
    this.id = binding.id;
    this.version = binding.manifest.version ?? "0.0.0";
  }

  get definition() {
    return this.binding.agent;
  }

  /** Prompt from instructions + agent + skills. The work-items skill is CLI usage for chat, so it is excluded. */
  composePrompt({ targetPaths = [], budgetChars } = {}) {
    const budget = budgetChars ?? this.binding.resolveConfig().promptBudgetChars ?? 60000;
    return PromptComposer.for(this.binding, { budgetChars: budget }).addInstructionsFor(targetPaths).addAgent().addSkills({ exclude: ["work-items"] });
  }

  // eslint-disable-next-line no-unused-vars
  async validate(request) {}

  // eslint-disable-next-line no-unused-vars
  async perform(request, context) {
    throw new Error(`${this.id}: perform() is not implemented`);
  }

  #trackRuntime(runtime, models) {
    if (!runtime) return runtime;
    const binding = this.binding;
    return {
      calls: runtime.calls,
      async run(options) {
        const model = options.model ?? binding.model ?? undefined;
        const response = await runtime.run({ ...options, model, tools: options.tools ?? binding.tools });
        models.add(response.model ?? model ?? "sdk-default");
        return response;
      },
    };
  }

  async execute(request, context) {
    const started = Date.now();
    const models = new Set();
    const ctx = { ...context, runtime: this.#trackRuntime(context.runtime, models) };
    const { logger, hooks } = ctx;
    const hookContext = { agentId: this.id, requestId: request.requestId };
    const modelUsed = () => (models.size ? [...models].join(",") : null);

    logger.info("agent.started", { agentId: this.id, requestId: request.requestId, version: this.version, model: this.binding.model ?? "sdk-default" });
    await hooks?.run("sessionStart", { ...hookContext, initialPrompt: this.id });
    try {
      await this.validate(request);
      const result = await this.perform(request, ctx);
      result.metrics = { ...result.metrics, durationMs: Date.now() - started, model: modelUsed() };
      logger.info("agent.completed", { agentId: this.id, status: result.status, durationMs: result.metrics.durationMs, model: result.metrics.model });
      await hooks?.run("sessionEnd", { ...hookContext, reason: result.status, model: result.metrics.model });
      return result;
    } catch (error) {
      logger.error("agent.failed", { agentId: this.id, error: error.message });
      await hooks?.run("errorOccurred", { ...hookContext, error: { name: error.name, message: error.message } });
      await hooks?.run("sessionEnd", { ...hookContext, reason: "failed", model: modelUsed() });
      return createAgentResult(request, {
        status: "failed",
        summary: error.message,
        warnings: [error.code ?? "AGENT_ERROR"],
        metrics: { durationMs: Date.now() - started, model: modelUsed() },
      });
    }
  }
}
