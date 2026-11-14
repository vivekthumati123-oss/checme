import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreview, requireApprovedPreview } from "../../../../../../agents/node/modplanner/src/jira.js";

const plan = { application: "demo", summary: "Migrate", modules: [{ id: "core", order: 1, riskScore: 2, riskReason: "Small", effortDays: 1, dependsOn: [], tasks: ["Upgrade"] }] };

test("renders a deterministic preview without work-item access", () => {
  // Arrange
  const options = { project: "APP", runId: "first" };
  // Act
  const preview = buildPreview(plan, options);
  // Assert
  assert.equal(preview.digest, buildPreview(plan, options).digest);
  assert.equal(preview.epic.type, "Epic");
  assert.equal(preview.stories[0].type, "Story");
});

test("refuses approval for a changed plan", () => {
  // Arrange
  const preview = buildPreview(plan, { project: "APP", runId: "first" });
  const changed = buildPreview({ ...plan, summary: "Changed" }, { project: "APP", runId: "first" });
  // Act
  const attempt = () => requireApprovedPreview(preview, changed, { apply: true, digest: preview.digest });
  // Assert
  assert.throws(attempt, /unchanged reviewed/);
});