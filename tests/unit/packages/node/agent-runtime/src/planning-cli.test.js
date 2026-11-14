import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parsePlanningArgs } from "../../../../../../packages/node/agent-runtime/src/planning-cli.js";

test("parses an explicit preview approval and separate application workspace", () => {
  // Arrange
  const argv = ["create", "--run-id", "one", "--workspace", "app", "--project", "APP", "--apply", "--digest", "reviewed"];
  // Act
  const options = parsePlanningArgs(argv, {});
  // Assert
  assert.equal(options.payload.workspace, path.resolve("app"));
  assert.equal(options.payload.apply, true);
  assert.equal(options.payload.digest, "reviewed");
});

test("does not infer approval from an environment variable", () => {
  // Arrange
  const env = { PLANNING_MODE: "create", PLANNING_RUN_ID: "one", APPLY: "true" };
  // Act
  const options = parsePlanningArgs([], env);
  // Assert
  assert.equal(options.payload.apply, false);
});