import { test } from "node:test";
import assert from "node:assert/strict";
import { ModPlannerAgent } from "../../../../../../agents/node/modplanner/src/modplanner-agent.js";
import { buildPreview } from "../../../../../../agents/node/modplanner/src/jira.js";
import { memoryArtifacts, planningFixture } from "../../../../../node/helpers.js";
import { MockAgentRuntime } from "@l2/copilot-runtime";

const assessment = { application: "demo", currentStack: {}, targetStack: {}, modules: [{ id: "core", description: "Core", linesOfCode: 100, dependsOn: [], issues: [] }] };
const plan = { application: "demo", summary: "Migrate", modules: [{ id: "core", order: 1, dependsOn: [], riskScore: 1, riskReason: "Low", effortDays: 1, tasks: ["Upgrade"], status: "pending" }] };
const preview = buildPreview(plan, { project: "APP", runId: "one" });
const initial = { "assessment.json": assessment, "migration-plan.json": plan, "preview.json": preview };
const request = (mode, extra = {}) => ({ agentId: "modplanner", requestId: "fixture", payload: { mode, runId: "one", project: "APP", ...extra } });

function agent(binding) {
  const result = new ModPlannerAgent(binding);
  result.composePrompt = () => ({ build: () => ({ systemPrompt: "fixture" }) });
  return result;
}

function approvedEnvironment(testContext) {
  const previous = process.env.PLANNING_APPROVAL_GATE;
  process.env.PLANNING_APPROVAL_GATE = "reviewed-environment";
  testContext.after(() => {
    if (previous === undefined) delete process.env.PLANNING_APPROVAL_GATE;
    else process.env.PLANNING_APPROVAL_GATE = previous;
  });
}

test("preview persists reviewed payloads without Jira access", async () => {
  // Arrange
  const fixture = planningFixture("modplanner", { artifacts: memoryArtifacts(initial) });
  // Act
  const result = await agent(fixture.binding).execute(request("preview"), fixture.context);
  // Assert
  assert.equal(result.status, "succeeded", result.summary);
  assert.equal(result.data.preview.digest, preview.digest);
});

test("refuses creation when human confirmation is missing", async () => {
  // Arrange
  const fixture = planningFixture("modplanner", { artifacts: memoryArtifacts(initial) });
  // Act
  const result = await agent(fixture.binding).execute(request("create", { digest: preview.digest }), fixture.context);
  // Assert
  assert.equal(result.status, "failed");
  assert.match(result.summary, /explicit --apply/);
  assert.equal(fixture.context.artifacts.writes.length, 0);
});

test("checkpoints partial creation and refuses repeating it", async (testContext) => {
  // Arrange
  approvedEnvironment(testContext);
  const calls = [];
  const workItems = { async searchAll() { return []; }, async createWorkItem(provider, item) {
    calls.push(item.type);
    if (item.type === "Story") throw new Error("simulated interruption");
    return { id: "jira:APP-1" };
  } };
  const fixture = planningFixture("modplanner", { artifacts: memoryArtifacts(initial), workItems });
  const instance = agent(fixture.binding);
  const approved = request("create", { apply: true, digest: preview.digest });
  const first = await instance.execute(approved, fixture.context);
  // Act
  const second = await instance.execute(approved, fixture.context);
  // Assert
  assert.equal(first.status, "failed");
  assert.match(first.summary, /reconcile/);
  assert.match(second.summary, /Receipt already exists/);
  assert.deepEqual(calls, ["Epic", "Story"]);
  assert.equal((await fixture.context.artifacts.json("jira-created.json")).epic, "APP-1");
  assert.equal((await fixture.context.artifacts.json("jira-created.json")).status, "needs-reconciliation");
});

test("archives block recreation of the same application and project", async (testContext) => {
  // Arrange
  approvedEnvironment(testContext);
  const fixture = planningFixture("modplanner", { artifacts: memoryArtifacts(initial) });
  fixture.context.legacyIndex = { modplanner: [{ application: "demo", project: "APP", epic: "APP-1" }] };
  // Act
  const result = await agent(fixture.binding).execute(request("create", { apply: true, digest: preview.digest }), fixture.context);
  // Assert
  assert.equal(result.status, "failed");
  assert.match(result.summary, /Archived Jira state/);
});

test("generates through the runtime and stores the assessment and validated plan", async () => {
  // Arrange
  const runtime = MockAgentRuntime.replay({ plan });
  const fixture = planningFixture("modplanner", { runtime });
  // Act
  const result = await agent(fixture.binding).execute(request("plan", { assessment }), fixture.context);
  // Assert
  assert.equal(result.status, "succeeded", result.summary);
  assert.deepEqual(await fixture.context.artifacts.json("migration-plan.json"), plan);
  assert.equal(JSON.parse(runtime.calls[0].userPrompt).mode, "automation");
});