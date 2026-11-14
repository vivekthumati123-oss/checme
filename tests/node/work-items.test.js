import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  AzureDevOpsProvider, JiraProvider, GitHubIssuesProvider, WorkItemRouter, parseRef, createWorkItemProvider,
  extractAcceptanceCriteria, adfToText, textToAdf, htmlToText, textToHtml, loadEnvFile, runCli, describeConfig, WorkItemError,
} from "@l2/work-items";

import { fakeAzureDevOps, fakeJira, fakeGitHubIssues } from "./fake-apis.js";

const ADO_ENV = { ADO_ORG_URL: "https://dev.azure.com/demo", ADO_PROJECT: "Lending", ADO_PAT: "ado-secret-pat-123456" };
const JIRA_ENV = { JIRA_BASE_URL: "https://demo.atlassian.net", JIRA_EMAIL: "me@example.com", JIRA_API_TOKEN: "jira-secret-token-123456" };
const GH_ENV = { WORK_ITEMS_GITHUB_REPO: "acme/sandbox", GITHUB_TOKEN: "github_pat_secret_123456" };

test("parseRef: prefixes, bare Jira keys, GitHub refs and default provider", () => {
  assert.deepEqual(parseRef("ado:123"), { provider: "ado", id: "123" });
  assert.deepEqual(parseRef("jira:lend-7"), { provider: "jira", id: "LEND-7" });
  assert.deepEqual(parseRef("LEND-7"), { provider: "jira", id: "LEND-7" });
  assert.deepEqual(parseRef("github:acme/x#5"), { provider: "github", repo: "acme/x", id: "5" });
  assert.deepEqual(parseRef("#9"), { provider: "github", repo: null, id: "9" });
  assert.equal(parseRef("42", "azure-devops").provider, "ado");
  assert.throws(() => parseRef("42"), /Cannot tell which system/);
});

test("text helpers: HTML, ADF and acceptance criteria", () => {
  assert.equal(htmlToText("<ul><li>A &amp; B</li><li>C</li></ul>"), "- A & B\n- C");
  assert.equal(htmlToText(textToHtml("Para\n\n- x <y>\n- z")), "Para\n\n- x <y>\n- z");
  assert.equal(adfToText(textToAdf("Line 1\nLine 2\n\n- a\n- b")).trim(), "Line 1\nLine 2\n\n- a\n- b");
  assert.deepEqual(extractAcceptanceCriteria("Story\n\nAcceptance criteria\n- one\n- two\n\nNotes\nx"), ["one", "two"]);
  assert.deepEqual(extractAcceptanceCriteria("AC-1: a\nAC-2: b"), ["AC-1: a", "AC-2: b"]);
});

test("factory: missing configuration names the variables, never the values", () => {
  assert.throws(() => createWorkItemProvider("ado", {}), /ADO_ORG_URL, ADO_PROJECT, ADO_PAT/);
  assert.throws(() => createWorkItemProvider("jira", { JIRA_BASE_URL: "x" }), /JIRA_EMAIL, JIRA_API_TOKEN/);
  assert.throws(() => createWorkItemProvider("nope", {}), /Unknown work item provider/);
  assert.equal(createWorkItemProvider("jira", { JIRA_BASE_URL: "https://j", JIRA_PAT: "p" }).deployment, "datacenter");
  const cfg = JSON.stringify(describeConfig({ ...ADO_ENV, ...JIRA_ENV }));
  assert.ok(!cfg.includes("secret"));
});

test("ADO: get, children, create with json-patch + parent link + inherited paths, comment, link, search", async () => {
  const api = fakeAzureDevOps();
  const ado = new AzureDevOpsProvider({ orgUrl: ADO_ENV.ADO_ORG_URL, project: "Lending", pat: ADO_ENV.ADO_PAT, fetch: api.fetch });

  const story = await ado.getWorkItem("101");
  assert.equal(story.title, "Late payment fee for consumer loans");
  assert.deepEqual(story.acceptanceCriteria, ["AC-1: Fee is 2% per started 30-day period", "AC-2: No fee within a 5-day grace period"]);
  assert.deepEqual(story.tags, ["collections", "fees"]);
  assert.equal(api.calls[0].auth, `Basic ${Buffer.from(`:${ADO_ENV.ADO_PAT}`).toString("base64")}`);

  const created = await ado.createChildItems("101", [{ title: "Add fee calc", description: "- step 1\n- step 2", estimate: 4, tags: ["agent-generated"] }]);
  const post = api.calls.find((c) => c.method === "POST" && c.path.includes("$Task"));
  assert.equal(post.contentType, "application/json-patch+json");
  const ops = Object.fromEntries(post.body.filter((o) => o.path !== "/relations/-").map((o) => [o.path, o.value]));
  assert.equal(ops["/fields/System.AreaPath"], "Lending\\Collections");
  assert.equal(ops["/fields/System.IterationPath"], "Lending\\Sprint 12");
  assert.equal(ops["/fields/Microsoft.VSTS.Scheduling.RemainingWork"], 4);
  assert.equal(ops["/fields/System.Tags"], "agent-generated");
  assert.match(ops["/fields/System.Description"], /<ul><li>step 1<\/li>/);
  assert.deepEqual(post.body.find((o) => o.path === "/relations/-").value, { rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/demo/_apis/wit/workItems/101" });
  assert.match(created[0].url, /_workitems\/edit\/201$/);

  assert.deepEqual((await ado.getChildren("101")).map((c) => c.title), ["Add fee calc"]);
  await ado.addComment("101", "hello");
  assert.deepEqual(api.items[101].comments, ["hello"]);
  await ado.addLink("101", "https://github.com/acme/x/pull/3", "pull-request");
  assert.deepEqual(api.items[101].relations.at(-1), { rel: "Hyperlink", url: "https://github.com/acme/x/pull/3", attributes: { comment: "pull-request" } });
  assert.equal((await ado.search("late payment")).length, 1);
});

test("ADO: errors are actionable and never contain the PAT", async () => {
  const api = fakeAzureDevOps();
  const ado = new AzureDevOpsProvider({ orgUrl: ADO_ENV.ADO_ORG_URL, project: "Lending", pat: ADO_ENV.ADO_PAT, fetch: api.fetch });
  await assert.rejects(() => ado.getWorkItem("999"), (e) => e instanceof WorkItemError && e.status === 404 && /wrong ID\/project/.test(e.message) && !e.message.includes(ADO_ENV.ADO_PAT));
  await assert.rejects(() => ado.getWorkItem("abc"), /invalid work item id/);
});

test("Jira Cloud: v3 + Basic auth, ADF in and out, discovered sub-task type, remote link", async () => {
  const api = fakeJira();
  const jira = new JiraProvider({ baseUrl: JIRA_ENV.JIRA_BASE_URL, email: JIRA_ENV.JIRA_EMAIL, apiToken: JIRA_ENV.JIRA_API_TOKEN, fetch: api.fetch });
  const story = await jira.getWorkItem("LEND-1");
  assert.equal(story.url, "https://demo.atlassian.net/browse/LEND-1");
  assert.deepEqual(story.acceptanceCriteria, ["AC-1: Fee is 2% per started 30-day period", "AC-2: No fee within a 5-day grace period"]);
  const created = await jira.createChildItems("LEND-1", [{ title: "Add fee calc", description: "Do it", estimate: 3, tags: ["agent generated"] }]);
  const post = api.calls.find((c) => c.method === "POST" && c.path === "/rest/api/3/issue");
  assert.deepEqual(post.body.fields.issuetype, { id: "10003" });
  assert.deepEqual(post.body.fields.parent, { key: "LEND-1" });
  assert.equal(post.body.fields.description.type, "doc");
  assert.deepEqual(post.body.fields.labels, ["agent-generated"]);
  assert.equal(created[0].id, "LEND-2");
  assert.deepEqual((await jira.getChildren("LEND-1")).map((c) => c.id), ["LEND-2"]);
  await jira.addComment("LEND-1", "hi");
  assert.equal(api.issues["LEND-1"].comments[0].type, "doc");
  await jira.addLink("LEND-1", "https://github.com/acme/x/pull/3", "pull-request");
  assert.equal(api.issues["LEND-1"].remotelinks[0].url, "https://github.com/acme/x/pull/3");
  await jira.search("late fee");
  assert.ok(api.calls.at(-1).path.endsWith("/rest/api/3/search/jql"));
  assert.match(decodeURIComponent(api.calls.at(-1).query.get("jql")), /text ~ "late fee"/);
});

test("Jira Data Center: v2 + Bearer PAT, plain-text description, fallback sub-task name", async () => {
  const api = fakeJira({ baseUrl: "https://jira.corp", deployment: "datacenter", subtaskTypes: false });
  const jira = new JiraProvider({ baseUrl: "https://jira.corp", pat: "dc-pat-secret-123456", fetch: api.fetch });
  assert.equal(jira.deployment, "datacenter");
  const story = await jira.getWorkItem("LEND-1");
  assert.match(story.description, /collections officer/);
  await jira.createChildItems("LEND-1", [{ title: "x", description: "plain" }]);
  const post = api.calls.find((c) => c.method === "POST" && c.path === "/rest/api/2/issue");
  assert.equal(typeof post.body.fields.description, "string");
  assert.deepEqual(post.body.fields.issuetype, { name: "Sub-task" });
  assert.equal(api.calls[0].auth, "Bearer dc-pat-secret-123456");
});

test("GitHub Issues: sub-issues when available, body marker fallback, comments as links", async () => {
  for (const subIssues of [true, false]) {
    const api = fakeGitHubIssues({ subIssues });
    const gh = new GitHubIssuesProvider({ repo: "acme/sandbox", token: GH_ENV.GITHUB_TOKEN, fetch: api.fetch });
    assert.deepEqual((await gh.getWorkItem("#1")).acceptanceCriteria, ["AC-1: Fee is 2% per started 30-day period", "AC-2: No fee within a 5-day grace period"]);
    await gh.createChildItems("1", [{ title: "Child", estimate: 2 }]);
    assert.match(api.issues[2].body, /Estimate: 2h\n\nParent: #1/);
    assert.deepEqual((await gh.getChildren("1")).map((c) => c.title), ["Child"], `subIssues=${subIssues}`);
    await gh.addLink("1", "https://x/pr/1", "pull-request");
    assert.equal(api.issues[1].comments[0], "Linked pull-request: https://x/pr/1");
  }
});

test("router: dispatches by prefix, returns full references usable as input", async () => {
  const ado = fakeAzureDevOps();
  const jira = fakeJira();
  const fetch = (url, init) => (url.includes("dev.azure.com") ? ado.fetch(url, init) : jira.fetch(url, init));
  const router = new WorkItemRouter({ env: { ...ADO_ENV, ...JIRA_ENV }, fetch });
  const story = await router.getWorkItem("ado:101");
  assert.equal(story.id, "ado:101");
  const [child] = await router.createChildItems(story.id, [{ title: "t" }]);
  assert.equal(child.id, "ado:201");
  assert.equal((await router.getWorkItem("LEND-1")).id, "jira:LEND-1");
  assert.equal((await router.getChildren("ado:101"))[0].id, "ado:201");
});

test("CLI: write commands are dry runs until --apply; create-children skips existing titles", async () => {
  const api = fakeAzureDevOps();
  const dir = await mkdtemp(path.join(tmpdir(), "wi-"));
  const file = path.join(dir, "tasks.json");
  await writeFile(file, JSON.stringify({ tasks: [{ title: "A", estimateHours: 2 }, { title: "B", estimateHours: 3, acceptanceCriterionRef: "AC-2" }] }));
  const outputs = [];
  const run = (argv) => runCli(argv, { env: { ...ADO_ENV }, fetch: api.fetch, out: (o) => outputs.push(o) });

  await run(["create-children", "ado:101", "--file", file]);
  assert.equal(outputs.at(-1).dryRun, true);
  assert.equal(api.calls.filter((c) => c.method === "POST").length, 0);

  await run(["create-children", "ado:101", "--file", file, "--apply"]);
  assert.equal(outputs.at(-1).created.length, 2);
  await run(["create-children", "ado:101", "--file", file, "--apply"]);
  assert.equal(outputs.at(-1).created.length, 0);
  assert.equal(outputs.at(-1).skippedExisting, 2);

  await run(["comment", "ado:101", "note"]);
  assert.equal(outputs.at(-1).dryRun, true);
  await run(["get", "ado:101"]);
  assert.equal(outputs.at(-1).title, "Late payment fee for consumer loans");
  await assert.rejects(() => run(["frobnicate"]), /Usage:/);
});

test("loadEnvFile: finds .env.local upward and never overrides existing variables", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "env-"));
  await mkdir(path.join(dir, "a", "b"), { recursive: true });
  await writeFile(path.join(dir, ".env.local"), "# comment\nADO_PROJECT=FromFile\nexport JIRA_PROJECT='LEND'\nADO_PAT=\"quoted\"\n");
  const env = { ADO_PROJECT: "FromShell" };
  const found = loadEnvFile({ start: path.join(dir, "a", "b"), env, file: undefined });
  assert.equal(found, path.join(dir, ".env.local"));
  assert.deepEqual([env.ADO_PROJECT, env.JIRA_PROJECT, env.ADO_PAT], ["FromShell", "LEND", "quoted"]);
});
