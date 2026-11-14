import { test } from "node:test";
import assert from "node:assert/strict";

import { loadBinding, HookRunner, InMemoryWorkItemProvider, createAgentRequest } from "@l2/agent-core";
import { InMemoryScmProvider } from "@l2/github-adapter";
import { MockAgentRuntime } from "@l2/copilot-runtime";
import { WorkItemRouter } from "@l2/work-items";

import { TestGenAgent, selectSourceFiles, expectedTestPath, COMMENT_MARKER } from "../../agents/node/testgen/src/testgen-agent.js";
import { TaskSyncAgent, clampHours } from "../../agents/node/tasksync/src/tasksync-agent.js";
import { CodeConnectAgent, safeBranch } from "../../agents/node/codeconnect/src/codeconnect-agent.js";
import { context, prRequest } from "./helpers.js";
import { fakeAzureDevOps, fakeJira, fakeGitHubIssues } from "./fake-apis.js";

const testgen = await loadBinding("testgen");
const scmWith = (extra = {}) => new InMemoryScmProvider({ changedFiles: [{ path: "src/a.js", status: "modified" }], files: { "src/a.js": "export const add = (a, b) => a + b;" }, ...extra });
const good = { framework: "jest", files: [{ path: "tests/unit/a.test.js", sourcePath: "src/a.js", casesGenerated: 2, content: "// Arrange\n// Act\n// Assert" }], summary: "ok" };

test("testgen: helpers", () => {
  assert.deepEqual(selectSourceFiles([{ path: "src/a.js", status: "modified" }, { path: "src/a.test.js", status: "modified" }, { path: "src/gone.js", status: "removed" }]).map((f) => f.path), ["src/a.js"]);
  assert.equal(expectedTestPath("src/lending/emi.py", "pytest"), "tests/unit/lending/test_emi.py");
});

test("testgen: automation mode, model recorded, sticky comment, PAT-safe check", async () => {
  const scm = scmWith({ failChecks: true });
  const runtime = MockAgentRuntime.replay(good);
  const agent = new TestGenAgent(testgen);
  const first = await agent.execute(prRequest(testgen), context({ binding: testgen, scm, runtime }));
  await agent.execute(prRequest(testgen), context({ binding: testgen, scm, runtime }));
  assert.equal(first.status, "succeeded");
  assert.equal(JSON.parse(runtime.calls[0].userPrompt).mode, "automation");
  assert.equal(first.metrics.model, "mock:gpt-5");
  assert.equal(scm.comments.length, 1);
  assert.ok(scm.comments[0].body.startsWith(COMMENT_MARKER));
  assert.ok(first.warnings.some((w) => w.startsWith("Check run not published")));
});

test("testgen: hooks block secrets the policy would allow; docs-only skip has no model", async () => {
  const hooks = await HookRunner.load(testgen.root, { names: ["l2-guardrails"] });
  const leaked = await new TestGenAgent(testgen).execute(prRequest(testgen), context({ binding: testgen, scm: scmWith(), runtime: MockAgentRuntime.replay({ files: [{ path: "tests/unit/a.test.js", content: `t="ghp_${"x".repeat(36)}"` }] }), hooks }));
  assert.match(leaked.warnings[0], /hook: .*GitHub token/);
  const docs = await new TestGenAgent(testgen).execute(prRequest(testgen), context({ binding: testgen, scm: new InMemoryScmProvider({ changedFiles: [{ path: "docs/a.md", status: "modified" }] }), runtime: MockAgentRuntime.replay(good) }));
  assert.equal(docs.metrics.model, null);
});

test("tasksync + Azure DevOps (real provider, fake API): AC to model, json-patch children, dedupe, comment", async () => {
  const binding = await loadBinding("tasksync");
  const api = fakeAzureDevOps();
  const workItems = new WorkItemRouter({ env: { ADO_ORG_URL: "https://dev.azure.com/demo", ADO_PROJECT: "Lending", ADO_PAT: "p-123456789" }, fetch: api.fetch });
  const runtime = MockAgentRuntime.replay({ tasks: [{ title: "Add calculator", estimateHours: 12 }, { title: "Write tests", estimateHours: 0 }] });
  const request = createAgentRequest({ agentId: binding.id, payload: binding.resolveConfig({ storyId: "ado:101" }) });
  const first = await new TaskSyncAgent(binding).execute(request, context({ binding, runtime, workItems }));
  assert.equal(first.status, "succeeded", first.summary);
  assert.equal(first.data.totalEstimateHours, 9);
  assert.deepEqual(first.artifacts.map((a) => a.name), ["ado:201", "ado:202"]);
  assert.equal(JSON.parse(runtime.calls[0].userPrompt).story.acceptanceCriteria.length, 2);
  assert.match(api.items[101].comments[0], /TaskSync created 2 sub-task/);
  const second = await new TaskSyncAgent(binding).execute(request, context({ binding, runtime, workItems }));
  assert.equal(second.status, "skipped");
  assert.deepEqual(JSON.parse(runtime.calls[1].userPrompt).existingChildren, ["Add calculator", "Write tests"]);
  assert.equal(clampHours("abc"), 4);
});

test("tasksync + GitHub Issues and Jira: same agent, different systems", async () => {
  const binding = await loadBinding("tasksync");
  const runtime = MockAgentRuntime.replay({ tasks: [{ title: "Task A", estimateHours: 3 }] });
  const gh = fakeGitHubIssues();
  const jira = fakeJira();
  const env = { WORK_ITEMS_GITHUB_REPO: "acme/sandbox", GITHUB_TOKEN: "t-123456789", JIRA_BASE_URL: "https://demo.atlassian.net", JIRA_EMAIL: "a@b.c", JIRA_API_TOKEN: "j-123456789" };
  const fetch = (url, init) => (url.includes("atlassian") ? jira.fetch(url, init) : gh.fetch(url, init));
  const workItems = new WorkItemRouter({ env, fetch });
  for (const [storyId, created] of [["github:#1", "github:acme/sandbox#2"], ["jira:LEND-1", "jira:LEND-2"]]) {
    const r = await new TaskSyncAgent(binding).execute(createAgentRequest({ agentId: binding.id, payload: binding.resolveConfig({ storyId }) }), context({ binding, runtime, workItems }));
    assert.equal(r.artifacts[0].name, created, r.summary);
  }
});

test("tasksync: dry run creates nothing; default policy would block creation", async () => {
  const binding = await loadBinding("tasksync");
  const workItems = new InMemoryWorkItemProvider({ "S-1": { id: "S-1", title: "Story" } });
  const runtime = MockAgentRuntime.replay({ tasks: [{ title: "A", estimateHours: 2 }] });
  const dry = await new TaskSyncAgent(binding).execute(createAgentRequest({ agentId: binding.id, dryRun: true, payload: { storyId: "S-1" } }), context({ binding, runtime, workItems }));
  assert.match(dry.summary, /^Dry run/);
  assert.equal(Object.keys(workItems.items).length, 1);
  const gated = await new TaskSyncAgent(binding).execute(createAgentRequest({ agentId: binding.id, payload: { storyId: "S-1" } }), context({ binding, runtime, workItems, policy: { rules: [{ action: "work-item.read", effect: "allow" }] } }));
  assert.equal(gated.status, "failed");
});

test("codeconnect + Jira: reads target repo, policy+hooks filter files, draft PR, remote link on the issue", async () => {
  const binding = await loadBinding("codeconnect");
  const jira = fakeJira();
  const workItems = new WorkItemRouter({ env: { JIRA_BASE_URL: "https://demo.atlassian.net", JIRA_EMAIL: "a@b.c", JIRA_API_TOKEN: "j-123456789" }, fetch: jira.fetch });
  const scm = new InMemoryScmProvider({ files: { "src/lending/interest.js": "export const x = 1;", "tests/unit/interest.test.js": "it('x',()=>{})", "README.md": "#" } });
  const runtime = MockAgentRuntime.replay({
    branch: "agent/codeconnect/jira:LEND-1",
    files: [{ path: "src/lending/late-fee.js", content: "export const lateFee = () => 1;" }, { path: ".github/workflows/ci.yml", content: "x" }],
    pullRequestTitle: "feat: late fee",
  });
  const hooks = await HookRunner.load(binding.root, { names: ["l2-guardrails"] });
  const result = await new CodeConnectAgent(binding).execute(prRequest(binding, { payload: binding.resolveConfig({ workItemId: "LEND-1" }) }), context({ binding, scm, runtime, hooks, workItems }));
  assert.equal(result.status, "succeeded", result.summary);
  const sent = JSON.parse(runtime.calls[0].userPrompt);
  assert.equal(sent.workItem.title, "Late payment fee for consumer loans");
  assert.deepEqual(sent.repository.examples.map((e) => e.path), ["src/lending/interest.js", "tests/unit/interest.test.js"]);
  assert.equal(scm.commits[0].branch, "agent/codeconnect/jira-LEND-1");
  assert.deepEqual(scm.commits[0].files.map((f) => f.path), ["src/lending/late-fee.js"]);
  assert.equal(scm.pullRequests[0].draft, true);
  assert.match(scm.pullRequests[0].body, /\[jira:LEND-1\]\(https:\/\/demo\.atlassian\.net\/browse\/LEND-1\)/);
  assert.equal(jira.issues["LEND-1"].remotelinks[0].url, "memory://pr/99");
  assert.equal(safeBranch("a b/../c"), "a-b/../c".replace(/\.\./, ".."));
});

test("codeconnect: dry run writes nothing anywhere", async () => {
  const binding = await loadBinding("codeconnect");
  const api = fakeAzureDevOps();
  const workItems = new WorkItemRouter({ env: { ADO_ORG_URL: "https://dev.azure.com/demo", ADO_PROJECT: "Lending", ADO_PAT: "p-123456789" }, fetch: api.fetch });
  const scm = new InMemoryScmProvider();
  const runtime = MockAgentRuntime.replay({ files: [{ path: "src/x.js", content: "x" }] });
  const r = await new CodeConnectAgent(binding).execute(prRequest(binding, { dryRun: true, payload: { workItemId: "ado:101" } }), context({ binding, scm, runtime, workItems }));
  assert.match(r.summary, /^Dry run/);
  assert.equal(scm.commits.length + scm.pullRequests.length, 0);
  assert.equal(api.calls.filter((c) => c.method !== "GET").length, 0);
});
