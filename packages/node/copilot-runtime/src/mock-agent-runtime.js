import { AgentRuntime } from "./agent-runtime.js";

/** Deterministic runtime for tests, demos and eval replay. Reports the model as `mock:<model>`. */
export class MockAgentRuntime extends AgentRuntime {
  constructor({ handlers = {} } = {}) {
    super();
    this.handlers = handlers;
    this.calls = [];
  }

  static replay(output) {
    return new MockAgentRuntime({ handlers: { default: async () => structuredClone(output) } });
  }

  async run(options) {
    this.calls.push(options);
    const handler = this.handlers[options.agentId] ?? this.handlers.default;
    const structuredOutput = handler ? await handler(options) : { summary: "mock runtime: no handler registered" };
    return {
      content: JSON.stringify(structuredOutput, null, 2),
      structuredOutput,
      model: `mock:${options.model ?? "sdk-default"}`,
      usage: {
        inputTokens: Math.ceil(((options.systemPrompt ?? "") + (options.userPrompt ?? "")).length / 4),
        outputTokens: Math.ceil(JSON.stringify(structuredOutput ?? {}).length / 4),
      },
    };
  }
}
