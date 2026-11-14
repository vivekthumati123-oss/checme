import { test } from "node:test";
import assert from "node:assert/strict";
import { linkKeys } from "../../../../../../agents/node/modplanner/src/link-keys.js";

test("links module IDs even after story titles change", () => {
  // Arrange
  const plan = { modules: [{ id: "core" }] };
  const receipt = { epic: "APP-1", stories: [{ moduleId: "core", key: "APP-2", summary: "Changed title" }] };
  // Act
  const linked = linkKeys(plan, receipt);
  // Assert
  assert.equal(linked.modules[0].jiraKey, "APP-2");
  assert.equal(plan.modules[0].jiraKey, undefined);
});

test("rejects ambiguous legacy receipt titles", () => {
  // Arrange
  const plan = { modules: [{ id: "core" }] };
  const receipt = { epic: "APP-1", stories: [{ key: "APP-2", summary: "1. Migrate core" }, { key: "APP-3", summary: "2. Migrate core" }] };
  // Act
  const attempt = () => linkKeys(plan, receipt);
  // Assert
  assert.throws(attempt, /unique Jira mapping/);
});