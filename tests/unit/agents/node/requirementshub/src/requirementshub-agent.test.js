import { test } from "node:test";
import assert from "node:assert/strict";
import { RequirementsHubAgent } from "../../../../../../agents/node/requirementshub/src/requirementshub-agent.js";
import { memoryArtifacts, planningFixture } from "../../../../../node/helpers.js";
import { MockAgentRuntime } from "@l2/copilot-runtime";

const document = { purposeScope: "Scope", epicOverview: "Epic", requirements: [{ frId: "FR-001", jiraKey: "APP-2", title: "Approval", description: "Source", acceptanceCriteria: [], businessRules: [], dependencies: [] }], nonFunctionalConsiderations: [], assumptions: [], openQuestions: [{ id: "Q1", frIds: ["FR-001"], text: "How many levels?", field: "businessRules" }] };
const workItems = { async getWorkItem() { return { type: "Epic", title: "Epic", description: "Source" }; }, async getEpicChildren() { return [{ id: "jira:APP-2", title: "Approval", description: "Source" }]; } };
const request = (mode, extra = {}) => ({ agentId: "requirementshub", requestId: "fixture", payload: { mode, epicKey: "APP-1", ...extra } });

function agent(binding) {
  const result = new RequirementsHubAgent(binding);
  result.composePrompt = () => ({ build: () => ({ systemPrompt: "fixture" }) });
  return result;
}

test("generates a draft with a durable source snapshot and FR-ID map", async () => {
  // Arrange
  const fixture = planningFixture("requirementshub", { workItems, runtime: MockAgentRuntime.replay(document) });
  // Act
  const result = await agent(fixture.binding).execute(request("generate"), fixture.context);
  // Assert
  assert.equal(result.status, "succeeded", result.summary);
  assert.equal((await fixture.context.artifacts.json("fr-ids.json"))["jira:APP-2"], "FR-001");
  assert.ok(await fixture.context.artifacts.json("snapshot-draft.json"));
});

test("finalizes only the stored draft and leaves it unchanged", async () => {
  // Arrange
  const fixture = planningFixture("requirementshub", { workItems, runtime: MockAgentRuntime.replay(document) });
  const instance = agent(fixture.binding);
  await instance.execute(request("generate"), fixture.context);
  const draft = await fixture.context.artifacts.read("FSD-APP-1.md");
  fixture.context.workItems = {};
  // Act
  const result = await instance.execute(request("finalize", { answers: [{ questionId: "Q1", answer: "Two levels", confirmed: true }] }), fixture.context);
  // Assert
  assert.equal(result.status, "succeeded", result.summary);
  assert.equal(await fixture.context.artifacts.read("FSD-APP-1.md"), draft);
  assert.match(await fixture.context.artifacts.read("FSD-APP-1-final.md"), /Two levels/);
});

test("rejects generation from a non-epic without invoking the model", async () => {
  // Arrange
  const runtime = MockAgentRuntime.replay(document);
  const fixture = planningFixture("requirementshub", { workItems: { async getWorkItem() { return { type: "Story" }; } }, runtime });
  // Act
  const result = await agent(fixture.binding).execute(request("generate"), fixture.context);
  // Assert
  assert.equal(result.status, "failed");
  assert.match(result.summary, /not an Epic/);
  assert.equal(runtime.calls.length, 0);
});

test("refuses finalization when a draft changed after its snapshot", async () => {
  // Arrange
  const artifacts = memoryArtifacts({ "FSD-APP-1.md": "changed", "snapshot-draft.json": { draftDigest: "old" } });
  const fixture = planningFixture("requirementshub", { artifacts });
  // Act
  const result = await agent(fixture.binding).execute(request("finalize", { answers: [] }), fixture.context);
  // Assert
  assert.equal(result.status, "failed");
  assert.match(result.summary, /immutable draft/);
});

test("rejects a modified snapshot even when the draft digest still matches", async () => {
  // Arrange
  const fixture = planningFixture("requirementshub", { workItems, runtime: MockAgentRuntime.replay(document) });
  const instance = agent(fixture.binding);
  await instance.execute(request("generate"), fixture.context);
  const snapshot = await fixture.context.artifacts.json("snapshot-draft.json");
  snapshot.document.purposeScope = "Altered snapshot";
  await fixture.context.artifacts.write("snapshot-draft.json", snapshot);
  // Act
  const result = await instance.execute(request("finalize", { answers: [] }), fixture.context);
  // Assert
  assert.equal(result.status, "failed");
  assert.match(result.summary, /no longer reproduces/);
});