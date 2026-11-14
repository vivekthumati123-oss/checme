import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePlan } from "../../../../../../agents/node/modplanner/src/planner.js";

const assessment = { application: "demo", currentStack: {}, targetStack: {}, modules: [{ id: "core", description: "Core", linesOfCode: 1, issues: [], dependsOn: [] }] };
const plan = { application: "demo", summary: "Migrate", modules: [{ id: "core", order: 1, dependsOn: [], riskScore: 1, riskReason: "Low", effortDays: 1, tasks: ["Upgrade"], status: "pending" }] };

test("corrects an invalid candidate using the original assessment", async () => {
  // Arrange
  const calls = [];
  const runtime = { async run(options) { calls.push(JSON.parse(options.userPrompt)); return { structuredOutput: calls.length === 1 ? {} : { plan } }; } };
  // Act
  const result = await generatePlan({ assessment, runtime, systemPrompt: "fixture", workspace: "fixture" });
  // Assert
  assert.deepEqual(result, plan);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].assessment, assessment);
  assert.ok(calls[1].validationProblems.length);
});

test("stops after three invalid responses", async () => {
  // Arrange
  let calls = 0;
  const runtime = { async run() { calls += 1; return { structuredOutput: {} }; } };
  // Act
  const result = generatePlan({ assessment, runtime, systemPrompt: "fixture", workspace: "fixture" });
  // Assert
  await assert.rejects(result, /after 3 attempts/);
  assert.equal(calls, 3);
});