import { AgentRuntime, parseStructuredOutput } from "./agent-runtime.js";

/**
 * Real runtime backed by `@github/copilot-sdk`, imported lazily.
 * Model: options.model (from l2/<id>.json) -> L2_DEFAULT_MODEL -> SDK default. Nothing hard-coded.
 * Pin the SDK version and re-check its session API before production use.
 */
const TOOL_KINDS = { read: ["read"], search: ["read"], edit: ["write"], execute: ["shell"], shell: ["shell"], web: ["url"] };

export class CopilotAgentRuntime extends AgentRuntime {
  constructor({ logger = null, defaultModel = process.env.L2_DEFAULT_MODEL ?? null, sdk = null } = {}) {
    super();
    this.logger = logger;
    this.defaultModel = defaultModel;
    this.sdk = sdk;
  }

  async #sdk() {
    if (this.sdk) return this.sdk;
    try {
      return await import("@github/copilot-sdk");
    } catch {
      throw new Error("@github/copilot-sdk is not installed. Run `npm install @github/copilot-sdk` or use AGENT_RUNTIME=mock.");
    }
  }

  async run(options) {
    const { CopilotClient } = await this.#sdk();
    const model = options.model ?? this.defaultModel ?? null;
    const client = new CopilotClient({ gitHubToken: process.env.COPILOT_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN });
    try {
      await client.start();
      const session = await client.createSession({
        ...(model ? { model } : {}),
        workingDirectory: options.workingDirectory,
        systemMessage: { content: options.systemPrompt },
        // Automation mode returns JSON; deny every tool so the SDK cannot edit or run anything.
        onPermissionRequest: (request) => this.#permission(request, options.allowTools ?? []),
      });
      const response = await session.sendAndWait({ prompt: options.userPrompt }, options.timeoutMs);
      const content = response?.data?.content ?? response?.content ?? "";
      return { content, structuredOutput: parseStructuredOutput(content), model: response?.data?.model ?? model ?? "sdk-default", usage: response?.data?.usage ?? {} };
    } finally {
      await client.stop();
    }
  }

  #permission(request, tools) {
    const allowedKinds = new Set(tools.flatMap((t) => TOOL_KINDS[t] ?? []));
    const kind = request?.kind ?? request?.type;
    if (kind && allowedKinds.has(kind)) return { kind: "approved" };
    this.logger?.warn?.("runtime.permission.denied", { kind });
    return { kind: "denied-by-rules" };
  }
}
