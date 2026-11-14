import assert from "node:assert/strict";
import test from "node:test";
import { validateDiagrams } from "../../../../../../agents/node/architectconnect/src/diagram-validator.js";

test("reports validity only from successful parser results", async () => {
  // Arrange
  const parsers = { mermaidParser: async () => ({ status: "valid" }), structurizrParser: async () => ({ status: "valid" }) };
  // Act
  const result = await validateDiagrams({ mermaid: "diagram", dsl: "workspace" }, parsers);
  // Assert
  assert.equal(result.mermaidGrammar, "valid");
  assert.equal(result.structurizrGrammar, "valid");
  assert.deepEqual(result.notes, []);
});

test("preserves unavailable Structurizr validation instead of claiming it passed", async () => {
  // Arrange
  const parsers = { mermaidParser: async () => ({ status: "valid" }), structurizrParser: async () => ({ status: "unverified", reason: "Java unavailable" }) };
  // Act
  const result = await validateDiagrams({ mermaid: "diagram", dsl: "workspace" }, parsers);
  // Assert
  assert.equal(result.structurizrGrammar, "unverified");
  assert.deepEqual(result.notes, ["Java unavailable"]);
});

test("reports grammar rejection distinctly from parser unavailability", async () => {
  // Arrange
  const parsers = { mermaidParser: async () => ({ status: "invalid" }), structurizrParser: async () => ({ status: "unverified" }) };
  // Act
  const result = await validateDiagrams({ mermaid: "invalid", dsl: "workspace" }, parsers);
  // Assert
  assert.equal(result.mermaidGrammar, "invalid");
  assert.equal(result.structurizrGrammar, "unverified");
});