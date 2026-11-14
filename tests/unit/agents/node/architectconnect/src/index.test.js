import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { parseArguments } from "../../../../../../agents/node/architectconnect/src/index.js";

test("defaults local analysis to dry-run in the caller workspace", () => {
  // Arrange
  const cwd = path.resolve("application");
  // Act
  const result = parseArguments(["--local", "."], {}, cwd);
  // Assert
  assert.equal(result.dryRun, true);
  assert.equal(result.workspace, cwd);
  assert.equal(result.payload.localPath, cwd);
});

test("requires an explicit application workspace before applying report writes", () => {
  // Arrange
  const args = ["https://github.com/team/app", "--apply"];
  // Act
  const action = () => parseArguments(args);
  // Assert
  assert.throws(action, /requires --workspace/);
});

test("routes an explicit direct GitHub source without requiring the HTTP bridge", () => {
  // Arrange
  const args = ["--github", "team/app"];
  // Act
  const result = parseArguments(args);
  // Assert
  assert.equal(result.payload.githubDirect, "team/app");
  assert.equal(result.payload.repositoryUrl, undefined);
  assert.equal(result.dryRun, true);
});

test("routes strict grammar validation as a persistence gate", () => {
  // Arrange
  const args = ["--local", ".", "--validate", "--require-validated"];
  // Act
  const result = parseArguments(args);
  // Assert
  assert.equal(result.payload.validateDiagrams, true);
  assert.equal(result.payload.requireValidated, true);
  assert.equal(result.dryRun, true);
});