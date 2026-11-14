import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { launcherCommand } from "../../../../../../.github/skills/l2-platform-runner/scripts/run.mjs";

test("keeps the caller workspace separate from the platform checkout", () => {
  // Arrange
  const root = path.resolve("platform");
  const workspace = path.resolve("application");
  // Act
  const command = launcherCommand(["modplanner", "preview", "--run-id", "one"], { env: { L2_PLATFORM_ROOT: root }, workspace, executable: "node" });
  // Assert
  assert.equal(command.cwd, root);
  assert.equal(command.env.APPLICATION_WORKSPACE, workspace);
  assert.equal(command.env.L2_ROOT, root);
  assert.deepEqual(command.args.slice(1), ["preview", "--run-id", "one"]);
});

test("rejects arbitrary agent entrypoints", () => {
  // Arrange
  const argv = ["../../outside", "create"];
  // Act
  const attempt = () => launcherCommand(argv, { env: { L2_PLATFORM_ROOT: "platform" } });
  // Assert
  assert.throws(attempt, /Choose modplanner/);
});

test("requires an explicit platform checkout", () => {
  // Arrange
  const argv = ["requirementshub", "generate"];
  // Act
  const attempt = () => launcherCommand(argv, { env: {} });
  // Assert
  assert.throws(attempt, /L2_PLATFORM_ROOT/);
});