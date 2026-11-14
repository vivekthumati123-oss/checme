import assert from "node:assert/strict";
import test from "node:test";
import { collectSnapshot, disposition, verifySnapshot } from "../../../scripts/archive-architectconnect.mjs";

function entry(name, directory = false) {
  return { name, isDirectory: () => directory, isFile: () => !directory, isSymbolicLink: () => false };
}

test("archives source text without reading credential files or traversing dependency trees", async () => {
  // Arrange
  const reads = [];
  const fs = {
    readdir: async () => [entry("scanner.js"), entry(".env.local"), entry("node_modules", true)],
    readFile: async (filePath) => { reads.push(filePath); return Buffer.from("export function scan() {}\n"); },
  };
  // Act
  const snapshot = await collectSnapshot("source", { fs, env: {} });
  // Assert
  assert.equal(reads.length, 1);
  assert.equal(snapshot.files.length, 1);
  assert.equal(snapshot.excluded.length, 2);
  assert.equal(verifySnapshot(snapshot), 1);
});

test("excludes known environment secret values from the archive without echoing them", async () => {
  // Arrange
  const fs = { readdir: async () => [entry("scanner.js")], readFile: async () => Buffer.from("fixture-sensitive-value") };
  // Act
  const snapshot = await collectSnapshot("source", { fs, env: { TEST_SECRET: "fixture-sensitive-value" } });
  // Assert
  assert.deepEqual(snapshot.files, []);
  assert.equal(snapshot.excluded[0].reason, "sensitive-content check; owner review required");
  assert.doesNotMatch(JSON.stringify(snapshot), /fixture-sensitive-value/);
});

test("rejects checksum tampering in the recoverable snapshot", () => {
  // Arrange
  const snapshot = { format: 1, files: [{ path: "scanner.js", content: "changed", sha256: "incorrect" }] };
  // Act
  const action = () => verifySnapshot(snapshot);
  // Assert
  assert.throws(action, /checksum/);
});

test("records migrated modules separately from the retired MCP transport", () => {
  // Arrange
  const migrated = new Set(["repositoryScanner.js"]);
  // Act
  const result = disposition("repositoryScanner.js", migrated);
  // Assert
  assert.equal(result.disposition, "migrated");
  assert.equal(result.target, "agents/node/architectconnect/src/engine/repositoryScanner.js");
});