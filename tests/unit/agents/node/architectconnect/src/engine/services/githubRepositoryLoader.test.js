import assert from "node:assert/strict";
import test from "node:test";
import { loadGitHubRepository, parseGitHubRepository } from "../../../../../../../../agents/node/architectconnect/src/engine/services/githubRepositoryLoader.js";

test("loads default-branch blobs and tree SHA while excluding credential records", async () => {
  // Arrange
  const calls = [];
  const octokit = {
    repos: {
      get: async () => ({ data: { default_branch: "release/main" } }),
      getBranch: async (args) => { calls.push(args); return { data: { commit: { commit: { tree: { sha: "tree-sha" } } } } }; },
    },
    git: {
      getTree: async () => ({ data: { tree: [
        { path: "package.json", type: "blob", sha: "package-sha" },
        { path: "README.md", type: "blob", sha: "readme-sha" },
        { path: ".env.local", type: "blob", sha: "credential-sha" },
      ] } }),
      getBlob: async (args) => { calls.push(args); return { data: { content: Buffer.from("{}").toString("base64"), encoding: "base64" } }; },
    },
  };
  // Act
  const result = await loadGitHubRepository("team", "app", { octokit });
  // Assert
  assert.equal(result.metadata.treeSha, "tree-sha");
  assert.equal(result.metadata.branch, "release/main");
  assert.equal(result.packageContent, "{}");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].branch, "release/main");
  assert.equal(result.contents.length, 2);
  assert.deepEqual(result.missingPaths, []);
});

test("reports truncated trees and unavailable blobs without echoing provider errors", async () => {
  // Arrange
  const octokit = {
    repos: { get: async () => ({ data: { default_branch: "main" } }), getBranch: async () => ({ data: { commit: { commit: { tree: { sha: "tree" } } } } }) },
    git: { getTree: async () => ({ data: { truncated: true, tree: [{ path: "src/app.js", type: "blob", sha: "source" }] } }), getBlob: async () => { throw new Error("private provider response"); } },
  };
  // Act
  const result = await loadGitHubRepository("team", "app", { octokit });
  // Assert
  assert.equal(result.treeTruncated, true);
  assert.deepEqual(result.missingPaths, ["src/app.js"]);
  assert.equal(result.contents[0].content, "");
});

test("rejects traversal segments in direct GitHub repository names", () => {
  // Arrange
  const slug = "../app";
  // Act
  const action = () => parseGitHubRepository(slug);
  // Assert
  assert.throws(action, /path traversal/);
});