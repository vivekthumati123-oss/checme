import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRepositoryContents, createArchitectureService } from "../../../../../../../../agents/node/architectconnect/src/engine/services/architectConnectService.js";

test("passes one selected model to HLD, DSL, and ADR generators while preserving repository evidence", () => {
  // Arrange
  const selected = { applications: [{ id: "api" }], apis: [], components: [], relationships: [] };
  const findings = { applications: [], apis: [], components: [], relationships: [], gaps: ["unknown deployment"], selectedArchitecture: { architecture: selected } };
  const seen = [];
  const capture = (value) => { seen.push(value); return "output"; };
  const service = createArchitectureService({ scanner: () => findings, hldGenerator: capture, dslGenerator: capture, adrGenerator: capture });
  // Act
  const result = service.analyzeRepositoryContents([]);
  // Assert
  assert.equal(seen[0], seen[1]);
  assert.equal(seen[1], seen[2]);
  assert.deepEqual(seen[0].applications, selected.applications);
  assert.deepEqual(seen[0].gaps, findings.gaps);
  assert.equal(result.findings, findings);
  assert.deepEqual(findings.applications, []);
});

test("generates nonempty HLD and DSL and proposed ADR arrays for an Express fixture", () => {
  // Arrange
  const packageContent = JSON.stringify({ name: "fixture-api", dependencies: { express: "4" } });
  const contents = [
    { name: "package.json", path: "package.json", content: packageContent },
    { name: "app.js", path: "src/app.js", content: 'const express = require("express"); const app = express(); app.get("/users", listUsers);' },
    { name: "userService.js", path: "src/services/userService.js", content: "module.exports.listUsers = () => [];" },
  ];
  // Act
  const result = analyzeRepositoryContents(contents, packageContent, { repository: "fixture/api", branch: "main" });
  // Assert
  assert.ok(result.hld.trim());
  assert.ok(result.dsl.trim());
  assert.ok(Array.isArray(result.adrs));
  assert.equal(result.repository, "fixture/api");
  assert.ok(result.findings.languages.includes("JavaScript"));
});

test("preserves an empty-repository fallback without fabricating HTTP APIs", () => {
  // Arrange
  const contents = [];
  // Act
  const result = analyzeRepositoryContents(contents);
  // Assert
  assert.equal(result.findings.selectedArchitecture.fallbackUsed, true);
  assert.deepEqual(result.selectedFindings.apis, []);
  assert.deepEqual(result.adrs, []);
});

test("retains Python and FastAPI evidence from normalized source records", () => {
  // Arrange
  const contents = [
    { name: "requirements.txt", path: "requirements.txt", content: "fastapi" },
    { name: "main.py", path: "app/main.py", content: 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/users")\ndef users():\n    return []' },
  ];
  // Act
  const result = analyzeRepositoryContents(contents);
  // Assert
  assert.ok(result.findings.languages.includes("Python"));
  assert.ok(result.findings.frameworks.includes("FastAPI"));
  assert.ok(result.hld.includes("FastAPI"));
});