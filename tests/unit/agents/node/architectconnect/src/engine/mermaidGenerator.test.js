import assert from "node:assert/strict";
import test from "node:test";
import { generateMermaid } from "../../../../../../../agents/node/architectconnect/src/engine/mermaidGenerator.js";

test("renders only relationships whose endpoints are verified nodes", () => {
  // Arrange
  const architecture = { applications: [{ id: "api", name: "API" }], components: [{ name: "service" }], relationships: [
    { from: "api", to: "service", relationship: "calls" }, { from: "api", to: "unknown", relationship: "uses" },
  ] };
  // Act
  const result = generateMermaid(architecture);
  // Assert
  assert.match(result.content, /node0 -->\|"calls"\| node1/);
  assert.doesNotMatch(result.content, /unknown/);
  assert.equal(result.omittedRelationships, 1);
});

test("escapes untrusted labels instead of allowing Mermaid syntax injection", () => {
  // Arrange
  const architecture = { applications: [{ id: "api", name: 'API"] --> evil["<script>' }] };
  // Act
  const result = generateMermaid(architecture);
  // Assert
  assert.match(result.content, /&quot;/);
  assert.doesNotMatch(result.content, /<script>/);
});