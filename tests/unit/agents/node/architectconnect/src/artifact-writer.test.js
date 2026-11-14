import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { normalizeArtifactPath, writeArtifacts } from "../../../../../../agents/node/architectconnect/src/artifact-writer.js";

const files = [{ path: "docs/hld/example/report.md", content: "Architecture evidence" }];
const allowed = { evaluate: () => ({ allowed: true, requiresApproval: false }) };
const hooks = { allowTool: async () => ({ decision: "allow", results: [] }) };

test("preflights dry-run artifacts without touching the filesystem", async () => {
  // Arrange
  const fs = new Proxy({}, { get() { throw new Error("Dry run accessed the filesystem"); } });
  // Act
  const result = await writeArtifacts({ files, policy: allowed, hooks, fs });
  // Assert
  assert.equal(result[0].saved, false);
  assert.equal(result[0].path, files[0].path);
});

test("rejects traversal before normalizing away unsafe segments", () => {
  // Arrange
  const unsafe = "docs/hld/../report.md";
  // Act
  const action = () => normalizeArtifactPath(unsafe);
  // Assert
  assert.throws(action, /inside the application workspace/);
});

test("does not treat a requires-approval policy as permission to write", async () => {
  // Arrange
  const policy = { evaluate: () => ({ allowed: true, requiresApproval: true }) };
  // Act
  const action = writeArtifacts({ files, policy, hooks });
  // Assert
  await assert.rejects(action, /requires external approval/);
});

test("fails closed when a hook reports an execution error", async () => {
  // Arrange
  const broken = { allowTool: async () => ({ decision: "allow", results: [{ error: "spawn failed" }] }) };
  // Act
  const action = writeArtifacts({ files, policy: allowed, hooks: broken });
  // Assert
  await assert.rejects(action, /guardrail execution error/);
});

test("rejects a symlinked application workspace before creating reports", async () => {
  // Arrange
  const fs = { lstat: async () => ({ isSymbolicLink: () => true }) };
  // Act
  const action = writeArtifacts({ files, workspace: path.resolve("application"), policy: allowed, hooks, dryRun: false, fs });
  // Assert
  await assert.rejects(action, /not a symlink/);
});

test("does not overwrite an existing report", async () => {
  // Arrange
  const workspace = path.resolve("application");
  const target = path.join(workspace, files[0].path);
  const fs = {
    realpath: async () => workspace,
    lstat: async (filePath) => ({ isSymbolicLink: () => false, isDirectory: () => filePath !== target }),
  };
  // Act
  const action = writeArtifacts({ files, workspace, policy: allowed, hooks, dryRun: false, fs });
  // Assert
  await assert.rejects(action, /already exists/);
});

test("uses exclusive file creation after safe directory checks", async () => {
  // Arrange
  const workspace = path.resolve("application");
  const writes = [];
  const fs = {
    realpath: async () => workspace,
    lstat: async (filePath) => {
      if (filePath.endsWith("report.md")) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return { isSymbolicLink: () => false, isDirectory: () => true };
    },
    mkdir: async () => {},
    writeFile: async (filePath, content, options) => { writes.push({ filePath, content, options }); },
  };
  // Act
  const result = await writeArtifacts({ files, workspace, policy: allowed, hooks, dryRun: false, fs });
  // Assert
  assert.equal(result[0].saved, true);
  assert.equal(writes[0].options.flag, "wx");
  assert.equal(writes[0].filePath, path.join(workspace, files[0].path));
});