import { test } from "node:test";
import assert from "node:assert/strict";
import { JiraProvider, WorkItemRouter } from "../../../../../../.github/skills/work-items/scripts/wi.mjs";

test("creates a Story under an Epic without selecting a subtask type", async () => {
  // Arrange
  const calls = [];
  const provider = new JiraProvider({ baseUrl: "https://jira.example", email: "test@example.com", apiToken: "fixture", fetch: async (url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ key: "APP-2" }), { status: 201 });
  } });
  const router = new WorkItemRouter({ providers: { jira: provider } });
  // Act
  const result = await router.createWorkItem("jira", { project: "APP", type: "Story", title: "Migrate", parentId: "jira:APP-1" });
  // Assert
  assert.equal(result.id, "jira:APP-2");
  assert.deepEqual(calls[0].fields.issuetype, { name: "Story" });
  assert.deepEqual(calls[0].fields.parent, { key: "APP-1" });
});

test("follows Cloud continuation tokens for epic children", async () => {
  // Arrange
  const calls = [];
  const provider = new JiraProvider({ baseUrl: "https://jira.example", email: "test@example.com", apiToken: "fixture", fetch: async (url) => {
    calls.push(new URL(url));
    return new Response(JSON.stringify(calls.length === 1
      ? { issues: [{ key: "APP-2", fields: { summary: "First" } }], nextPageToken: "next" }
      : { issues: [{ key: "APP-3", fields: { summary: "Second" } }], isLast: true }));
  } });
  // Act
  const children = await provider.getEpicChildren("APP-1");
  // Assert
  assert.deepEqual(children.map((item) => item.id), ["APP-2", "APP-3"]);
  assert.equal(calls[1].searchParams.get("nextPageToken"), "next");
  assert.equal(calls[1].searchParams.has("startAt"), false);
});

test("rejects invalid creation before sending a request", async () => {
  // Arrange
  const provider = new JiraProvider({ baseUrl: "https://jira.example", email: "test@example.com", apiToken: "fixture", fetch: async () => assert.fail("Unexpected request") });
  // Act
  const result = provider.createWorkItem({ project: "APP", type: "Story", title: "No parent" });
  // Assert
  await assert.rejects(result, /epic parent/);
});

test("does not retry an ambiguous Epic POST after a service error", async () => {
  // Arrange
  let calls = 0;
  const provider = new JiraProvider({ baseUrl: "https://jira.example", email: "test@example.com", apiToken: "fixture", fetch: async () => {
    calls += 1;
    return new Response("uncertain outcome", { status: 503 });
  } });
  // Act
  const result = provider.createWorkItem({ project: "APP", type: "Epic", title: "Migrate" });
  // Assert
  await assert.rejects(result, /503/);
  assert.equal(calls, 1);
});

test("follows Data Center offsets while preserving text descriptions", async () => {
  // Arrange
  const offsets = [];
  const provider = new JiraProvider({ baseUrl: "https://jira.example", pat: "fixture", fetch: async (url) => {
    const offset = new URL(url).searchParams.get("startAt");
    offsets.push(offset);
    return new Response(JSON.stringify({ total: 2, issues: [{ key: offset === "0" ? "APP-2" : "APP-3", fields: { summary: "Story", description: "Plain source" } }] }));
  } });
  // Act
  const children = await provider.getEpicChildren("APP-1");
  // Assert
  assert.deepEqual(offsets, ["0", "1"]);
  assert.equal(children[1].description, "Plain source");
});