import { test } from "node:test";
import assert from "node:assert/strict";
import { CopilotAgentRuntime } from "../../../../../../packages/node/copilot-runtime/src/copilot-agent-runtime.js";

test("passes a bounded timeout and denies model tool permissions", async () => {
  // Arrange
  const calls = [];
  class Client {
    constructor(options) { assert.ok(Object.hasOwn(options, "gitHubToken")); }
    async start() { calls.push("start"); }
    async createSession(options) {
      calls.push(options.onPermissionRequest({ kind: "shell" }).kind);
      return { async sendAndWait(prompt, timeout) { calls.push(timeout); return { data: { content: "{}" } }; } };
    }
    async stop() { calls.push("stop"); }
  }
  const runtime = new CopilotAgentRuntime({ sdk: { CopilotClient: Client } });
  // Act
  await runtime.run({ userPrompt: "{}", timeoutMs: 180000 });
  // Assert
  assert.deepEqual(calls, ["start", "denied-by-rules", 180000, "stop"]);
});

test("stops the SDK client even if startup fails", async () => {
  // Arrange
  let stopped = false;
  class Client {
    async start() { throw new Error("startup failure"); }
    async stop() { stopped = true; }
  }
  const runtime = new CopilotAgentRuntime({ sdk: { CopilotClient: Client } });
  // Act
  const result = runtime.run({});
  // Assert
  await assert.rejects(result, /startup failure/);
  assert.equal(stopped, true);
});