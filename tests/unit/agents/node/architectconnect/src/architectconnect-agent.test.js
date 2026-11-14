import assert from "node:assert/strict";
import test from "node:test";
import { ArchitectConnectAgent } from "../../../../../../agents/node/architectconnect/src/architectconnect-agent.js";

function agent() {
  return new ArchitectConnectAgent({ id: "architectconnect", agent: {}, manifest: { version: "0.1.0" }, resolveConfig: (payload) => payload });
}

test("prepares a guarded deterministic result without calling an LLM or saving reports by default", async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ["Date"], now: 0 });
  const request = { requestId: "fixture", agentId: "architectconnect", payload: { contents: [] }, dryRun: false };
  const runtime = { run: () => { throw new Error("An LLM was called"); } };
  const checked = [];
  const execution = {
    policy: { authorize: () => ({ allowed: true }), evaluate: () => ({ allowed: true }) },
    hooks: { allowTool: async (name, args) => { checked.push(args.path); return { decision: "allow" }; } }, runtime,
  };
  // Act
  const result = await agent().perform(request, execution);
  // Assert
  assert.equal(result.status, "succeeded");
  assert.equal(result.data.validation.saved, false);
  assert.equal(result.data.selection.fallbackUsed, true);
  assert.equal(result.artifacts.length, 3);
  assert.equal(checked.length, 4);
  assert.equal(result.metrics.model, null);
});

test("rejects simultaneous repository sources before acquisition", async () => {
  // Arrange
  const request = { payload: { contents: [], repositoryUrl: "https://github.com/team/app" } };
  // Act
  const action = agent().validate(request);
  // Assert
  await assert.rejects(action, /exactly one/);
});

test("rejects credential file records instead of scanning or echoing them", async () => {
  // Arrange
  const request = { payload: { contents: [{ path: ".env.local", content: "fixture sentinel" }] } };
  // Act
  const action = agent().validate(request);
  // Assert
  await assert.rejects(action, /non-credential paths/);
});