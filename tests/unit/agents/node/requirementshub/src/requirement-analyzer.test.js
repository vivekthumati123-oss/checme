import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeRequirements, captureRequirements } from "../../../../../../agents/node/requirementshub/src/requirement-analyzer.js";

test("keeps existing FR IDs when an earlier child is added", () => {
  // Arrange
  const children = [{ id: "jira:APP-2", title: "New", description: "" }, { id: "jira:APP-3", title: "Existing", description: "" }];
  // Act
  const captured = captureRequirements(children, { "jira:APP-3": "FR-001" });
  // Assert
  assert.equal(captured.ids["jira:APP-3"], "FR-001");
  assert.equal(captured.ids["jira:APP-2"], "FR-002");
});

test("handles missing summaries and preserves both keyword questions", () => {
  // Arrange
  const children = [{}, { title: "Approval notification" }];
  // Act
  const analysis = analyzeRequirements(children);
  // Assert
  assert.equal(analysis.requirementCount, 2);
  assert.equal(analysis.clarifications.length, 2);
});