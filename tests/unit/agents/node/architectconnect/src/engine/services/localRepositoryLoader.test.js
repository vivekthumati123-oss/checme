import assert from "node:assert/strict";
import test from "node:test";
import { loadLocalRepository } from "../../../../../../../../agents/node/architectconnect/src/engine/services/localRepositoryLoader.js";

test("loads normalized local sources without reading credential files", async () => {
  // Arrange
  const reads = [];
  const entry = (name) => ({ name, isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true });
  const fs = {
    lstat: async () => ({ isSymbolicLink: () => false, isDirectory: () => true, isFile: () => true, size: 2 }),
    readdir: async () => [entry("package.json"), entry(".env.local")],
    readFile: async (filePath) => { reads.push(filePath); return "{}"; },
  };
  // Act
  const result = await loadLocalRepository("application", { fs });
  // Assert
  assert.equal(reads.length, 1);
  assert.deepEqual(result.selectedPaths, ["package.json"]);
  assert.equal(result.packageContent, "{}");
});

test("refuses a symlinked local source directory", async () => {
  // Arrange
  const fs = { lstat: async () => ({ isSymbolicLink: () => true }) };
  // Act
  const action = loadLocalRepository("application", { fs });
  // Assert
  await assert.rejects(action, /not a symlink/);
});