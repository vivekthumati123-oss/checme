import assert from "node:assert/strict";
import test from "node:test";

import { selectArchitecture } from "../../../../../../../../../agents/node/architectconnect/src/engine/analyzers/discovery/architectureSelector.js";

function projection() {
  return {
    applications: [{ id: "worker", root: "." }], apis: [],
    components: [{ name: "worker", type: "service", applicationId: "worker" }],
    relationships: [{ from: "worker", to: "queue", relationship: "consumes", applicationId: "worker" }],
  };
}

test("selects a valid dynamic architecture with no HTTP APIs without mutating it", () => {
  // Arrange
  const input = projection();
  const original = structuredClone(input);
  // Act
  const result = selectArchitecture({ projection: input });
  // Assert
  assert.equal(result.source, "dynamic");
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.architecture, input);
  assert.deepEqual(input, original);
});

test("retains legacy architecture and the reason when dynamic relationships are incomplete", () => {
  // Arrange
  const input = { ...projection(), relationships: [{ from: "worker" }] };
  const legacy = { applications: [{ id: "legacy" }] };
  // Act
  const result = selectArchitecture({ projection: input, legacy });
  // Assert
  assert.equal(result.source, "legacy");
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.reason, "One or more architecture relationships are incomplete.");
  assert.deepEqual(result.architecture, { applications: legacy.applications, apis: [], components: [], relationships: [] });
});

test("falls back when a dynamic relationship references an unknown application", () => {
  // Arrange
  const input = { ...projection(), relationships: [{ from: "worker", to: "queue", relationship: "consumes", applicationId: "missing" }] };
  // Act
  const result = selectArchitecture({ projection: input });
  // Assert
  assert.equal(result.reason, "A dynamic relationship references an unknown application.");
  assert.equal(result.fallbackUsed, true);
});

test("normalizes a missing dynamic and legacy model to empty arrays", () => {
  // Arrange
  const input = {};
  // Act
  const result = selectArchitecture(input);
  // Assert
  assert.equal(result.reason, "Dynamic architecture projection is missing.");
  assert.deepEqual(result.architecture, { applications: [], apis: [], components: [], relationships: [] });
});