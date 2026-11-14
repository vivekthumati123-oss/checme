import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAssessment, validatePlan } from "../../../../../../agents/node/modplanner/src/validate.js";

const assessment = { application: "demo", currentStack: {}, targetStack: {}, modules: [{ id: "core", description: "Core", linesOfCode: 100, issues: [], dependsOn: [] }] };
const plan = { application: "demo", summary: "Migrate core", modules: [{ id: "core", order: 1, dependsOn: [], riskScore: 2, riskReason: "Small", effortDays: 1, tasks: ["Upgrade"], status: "pending" }] };

test("accepts a complete dependency-ordered migration plan", () => {
  // Arrange
  const input = structuredClone(plan);
  // Act
  const problems = validatePlan(input, assessment);
  // Assert
  assert.deepEqual(problems, []);
});

test("rejects absent arrays and malformed tasks without crashing", () => {
  // Arrange
  const input = { ...plan, modules: [{ ...plan.modules[0], dependsOn: undefined, tasks: [{}] }] };
  // Act
  const problems = validatePlan(input, assessment);
  // Assert
  assert.ok(problems.some((problem) => problem.includes("dependencies")));
  assert.ok(problems.some((problem) => problem.includes("tasks")));
});

test("rejects a cyclic assessment", () => {
  // Arrange
  const input = { ...assessment, modules: [{ ...assessment.modules[0], dependsOn: ["other"] }, { ...assessment.modules[0], id: "other", dependsOn: ["core"] }] };
  // Act
  const problems = validateAssessment(input);
  // Assert
  assert.deepEqual(problems, ["Dependency cycle detected"]);
});

test("rejects duplicated plan IDs", () => {
  // Arrange
  const input = { ...plan, modules: [...plan.modules, ...plan.modules] };
  // Act
  const problems = validatePlan(input, assessment);
  // Assert
  assert.ok(problems.some((problem) => problem.includes("without duplicates")));
});