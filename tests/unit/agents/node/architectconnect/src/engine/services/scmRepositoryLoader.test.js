import assert from "node:assert/strict";
import test from "node:test";
import { loadRepository, normalizeContents } from "../../../../../../../../agents/node/architectconnect/src/engine/services/scmRepositoryLoader.js";

test("normalizes slash paths and replaces non-string source content with an empty string", () => {
  // Arrange
  const files = [{ path: "src\\app.js", content: null }];
  // Act
  const result = normalizeContents(files);
  // Assert
  assert.equal(result[0].path, "src/app.js");
  assert.equal(result[0].name, "app.js");
  assert.equal(result[0].content, "");
});

test("preserves root package content and reports missing files without selecting credential paths", async () => {
  // Arrange
  const client = {
    getArchitectureContext: async () => ({ provider: "github", repository: { fullName: "team/app" }, ref: "main", tree: [
      { path: "package.json", type: "file" }, { path: "src/app.js", type: "file" },
      { path: ".env.local", type: "file" }, { path: "../secret.yaml", type: "file" },
    ] }),
    getFiles: async () => [{ path: "package.json", content: "{}" }],
  };
  // Act
  const result = await loadRepository("https://github.com/team/app", { client });
  // Assert
  assert.equal(result.packageContent, "{}");
  assert.deepEqual(result.selectedPaths, ["package.json", "src/app.js"]);
  assert.deepEqual(result.missingPaths, ["src/app.js"]);
});