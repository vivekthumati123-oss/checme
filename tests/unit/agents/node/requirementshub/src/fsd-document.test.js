import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDocument, renderDocument, applyAnswers, traceability } from "../../../../../../agents/node/requirementshub/src/fsd-document.js";

const captured = [{ frId: "FR-001", jiraKey: "APP-2", title: "Approval | notification", description: "Source" }];
const document = { purposeScope: "Scope", epicOverview: "Overview", requirements: [{ ...captured[0], acceptanceCriteria: [], businessRules: [], dependencies: [] }], nonFunctionalConsiderations: [], assumptions: [], openQuestions: [{ id: "Q1", frIds: ["FR-001"], text: "Approval levels?", field: "businessRules" }] };

test("renders six sections and one escaped traceability matrix", () => {
  // Arrange
  const source = { epic: { jiraKey: "APP-1", title: "Epic" }, requirements: captured };
  // Act
  const markdown = renderDocument(document, source);
  // Assert
  assert.equal((markdown.match(/## [1-6]\./g) ?? []).length, 6);
  assert.equal((markdown.match(/## Traceability Matrix/g) ?? []).length, 1);
  assert.ok(markdown.includes("Approval \\| notification"));
});

test("applies confirmed answers without altering source identities or the draft", () => {
  // Arrange
  const before = structuredClone(document);
  // Act
  const result = applyAnswers(document, [{ questionId: "Q1", answer: "Two approval levels", confirmed: true }], captured);
  // Assert
  assert.deepEqual(document, before);
  assert.deepEqual(result.resolved, ["Q1"]);
  assert.equal(result.document.requirements[0].frId, "FR-001");
  assert.equal(traceability(result.document.requirements), traceability(captured));
  assert.match(result.document.requirements[0].businessRules[0], /Two approval levels/);
});

test("retains vague BA answers as open questions", () => {
  // Arrange
  const answers = [{ questionId: "Q1", answer: "TBD", confirmed: true }];
  // Act
  const result = applyAnswers(document, answers, captured);
  // Assert
  assert.equal(result.document.openQuestions.length, 1);
  assert.deepEqual(result.resolved, []);
});

test("rejects changed FR IDs and unlinked proposals", () => {
  // Arrange
  const changed = { ...document, requirements: [{ ...document.requirements[0], frId: "FR-999", businessRules: ["Proposed: two levels"] }] };
  // Act
  const problems = validateDocument(changed, captured);
  // Assert
  assert.ok(problems.length >= 2);
});

test("rejects a model matrix at the start of a prose field", () => {
  // Arrange
  const input = { ...document, epicOverview: "## Traceability Matrix\nFake table" };
  // Act
  const problems = validateDocument(input, captured);
  // Assert
  assert.ok(problems.includes("Do not include a model-generated Traceability Matrix"));
});