import { test } from "node:test";
import assert from "node:assert/strict";
import { ArtifactStore, digest } from "../../../../../../packages/node/agent-runtime/src/artifact-store.js";

function fixture({ decision = "allow", symlink = false } = {}) {
  const calls = [];
  const fs = {
    async lstat() { return { isSymbolicLink: () => symlink }; },
    async mkdir() { calls.push("mkdir"); },
    async writeFile() { calls.push("write"); },
    async rename() { calls.push("rename"); },
    async unlink() { calls.push("unlink"); },
  };
  const context = { policy: { authorize: () => ({ requiresApproval: false }) }, hooks: {
    async allowTool() { return { decision }; }, async run() { calls.push("audit"); },
  } };
  return { calls, store: new ArtifactStore({ workspace: process.cwd(), directory: ".l2/modplanner/run", context, fs, uniqueId: () => "fixture" }) };
}

test("writes through a temporary artifact before renaming and auditing", async () => {
  // Arrange
  const { store, calls } = fixture();
  // Act
  await store.write("plan.json", { application: "example" });
  // Assert
  assert.deepEqual(calls, ["mkdir", "write", "rename", "unlink", "audit"]);
});

test("a denied hook prevents all filesystem mutations", async () => {
  // Arrange
  const { store, calls } = fixture({ decision: "deny" });
  // Act
  const result = store.write("plan.json", {});
  // Assert
  await assert.rejects(result, /Artifact guard failed/);
  assert.deepEqual(calls, []);
});

test("rejects symlink paths before reading input", async () => {
  // Arrange
  const { store } = fixture({ symlink: true });
  // Act
  const result = store.resolve("samples/assessment.json");
  // Assert
  await assert.rejects(result, /Symlink/);
});

test("rejects credential paths and traversal", async () => {
  // Arrange
  const { store } = fixture();
  // Act
  const results = Promise.allSettled([store.resolve("../outside"), store.resolve(".env.local")]);
  // Assert
  assert.deepEqual((await results).map((result) => result.status), ["rejected", "rejected"]);
});

test("computes stable digests for stored preview data", () => {
  // Arrange
  const value = { project: "APP", title: "Plan" };
  // Act
  const result = digest(value);
  // Assert
  assert.equal(result, digest(value));
  assert.notEqual(result, digest({ ...value, project: "OTHER" }));
});