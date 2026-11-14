import assert from "node:assert/strict";
import test from "node:test";
import { createScmBridgeClient, validateRepositoryUrl } from "../../../../../../../../agents/node/architectconnect/src/engine/services/scmBridgeClient.js";

test("requests the repository default branch using unchanged query names and envelopes", async () => {
  // Arrange
  const calls = [];
  const client = createScmBridgeClient({ baseUrl: "http://bridge.test:3210", fetchImpl: async (url) => {
    calls.push(url);
    return { ok: true, json: async () => url.pathname.endsWith("/repository")
      ? { provider: "gitlab", repository: { fullName: "team/app", defaultBranch: "release/main" } }
      : { tree: [{ path: "src/app.js", type: "file" }] } };
  } });
  // Act
  const result = await client.getArchitectureContext("https://gitlab.com/team/app");
  // Assert
  assert.equal(result.ref, "release/main");
  assert.equal(calls[1].searchParams.get("ref"), "release/main");
  assert.equal(calls[1].searchParams.get("repositoryUrl"), "https://gitlab.com/team/app");
  assert.equal(calls[0].origin, "http://bridge.test:3210");
});

test("does not include potentially sensitive HTTP response bodies in errors", async () => {
  // Arrange
  const client = createScmBridgeClient({ fetchImpl: async () => ({ ok: false, status: 401, text: async () => "private-response-body" }) });
  // Act
  const error = await client.getRepository("https://github.com/team/app").catch((failure) => failure);
  // Assert
  assert.equal(error.status, 401);
  assert.doesNotMatch(error.message, /private-response-body/);
});

test("rejects embedded repository credentials before acquisition", () => {
  // Arrange
  const repositoryUrl = "https://user:password@github.com/team/app";
  // Act
  const action = () => validateRepositoryUrl(repositoryUrl);
  // Assert
  assert.throws(action, /without credentials/);
});