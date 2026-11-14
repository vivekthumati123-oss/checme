/**
 * In-process fakes of the GitHub Issues, Jira (Cloud + Data Center) and Azure DevOps REST APIs.
 * They implement only the endpoints the providers call, record every request, and let tests and
 * the demo exercise the real provider code without network or credentials.
 */
const respond = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => (body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)),
});

function recorder() {
  const calls = [];
  const record = (url, init = {}) => {
    const u = new URL(url);
    const call = { method: init.method ?? "GET", url, path: u.pathname, query: u.searchParams, auth: init.headers?.Authorization, contentType: init.headers?.["Content-Type"], body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return call;
  };
  return { calls, record };
}

// ------------------------------------------------------------------ Azure DevOps
export function fakeAzureDevOps({ org = "https://dev.azure.com/demo", project = "Lending" } = {}) {
  const { calls, record } = recorder();
  let next = 200;
  const items = {
    101: {
      id: 101,
      fields: {
        "System.WorkItemType": "User Story", "System.Title": "Late payment fee for consumer loans", "System.State": "New",
        "System.Description": "<div>As a collections officer, I want overdue EMIs to attract a late fee.</div>",
        "Microsoft.VSTS.Common.AcceptanceCriteria": "<ul><li>AC-1: Fee is 2% per started 30-day period</li><li>AC-2: No fee within a 5-day grace period</li></ul>",
        "System.AreaPath": "Lending\\Collections", "System.IterationPath": "Lending\\Sprint 12", "System.Tags": "collections; fees",
      },
      relations: [],
    },
  };
  const html = (id) => `${org}/${project}/_workitems/edit/${id}`;
  const view = (w) => ({ ...w, _links: { html: { href: html(w.id) } } });
  const base = `/demo/${project}/_apis/wit`;

  async function fetch(url, init) {
    const c = record(url, init);
    if (!c.auth?.startsWith("Basic ")) return respond(401, { message: "TF400813" });
    let m;
    if (c.method === "GET" && (m = new RegExp(`^${base}/workitems/(\\d+)$`).exec(c.path))) {
      const w = items[m[1]];
      return w ? respond(200, view(w)) : respond(404, { message: "TF401232: Work item does not exist" });
    }
    if (c.method === "GET" && c.path === `${base}/workitems`) {
      const ids = c.query.get("ids").split(",");
      return respond(200, { value: ids.filter((id) => items[id]).map((id) => ({ id: Number(id), fields: items[id].fields })) });
    }
    if (c.method === "POST" && (m = new RegExp(`^${base}/workitems/\\$(.+)$`).exec(c.path))) {
      if (c.contentType !== "application/json-patch+json") return respond(415, { message: "json-patch required" });
      const id = (next += 1);
      const w = { id, fields: { "System.WorkItemType": decodeURIComponent(m[1]), "System.State": "New" }, relations: [] };
      for (const op of c.body) {
        if (op.path === "/relations/-") {
          w.relations.push(op.value);
          if (op.value.rel === "System.LinkTypes.Hierarchy-Reverse") {
            const parent = op.value.url.split("/").pop();
            items[parent]?.relations.push({ rel: "System.LinkTypes.Hierarchy-Forward", url: `${org}/_apis/wit/workItems/${id}` });
            w.fields["System.Parent"] = Number(parent);
          }
        } else w.fields[op.path.replace("/fields/", "")] = op.value;
      }
      items[id] = w;
      return respond(200, view(w));
    }
    if (c.method === "PATCH" && (m = new RegExp(`^${base}/workitems/(\\d+)$`).exec(c.path))) {
      for (const op of c.body) if (op.path === "/relations/-") items[m[1]].relations.push(op.value);
      return respond(200, view(items[m[1]]));
    }
    if (c.method === "POST" && (m = new RegExp(`^${base}/workItems/(\\d+)/comments$`).exec(c.path))) {
      (items[m[1]].comments ??= []).push(c.body.text);
      return respond(200, { id: items[m[1]].comments.length, text: c.body.text });
    }
    if (c.method === "POST" && c.path === `${base}/wiql`) {
      const term = /CONTAINS '([^']*)'/.exec(c.body.query)?.[1]?.toLowerCase() ?? "";
      return respond(200, { workItems: Object.values(items).filter((w) => w.fields["System.Title"].toLowerCase().includes(term)).map((w) => ({ id: w.id })) });
    }
    return respond(404, { message: `fake ADO: no route ${c.method} ${c.path}` });
  }
  return { fetch, calls, items };
}

// ------------------------------------------------------------------ Jira
const adf = (text) => ({ type: "doc", version: 1, content: text.split("\n\n").map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })) });

export function fakeJira({ baseUrl = "https://demo.atlassian.net", deployment = "cloud", subtaskTypes = true } = {}) {
  const { calls, record } = recorder();
  const v = deployment === "cloud" ? 3 : 2;
  let next = 1;
  const story = "As a collections officer, I want overdue EMIs to attract a late fee.\n\nAcceptance criteria\n\nAC-1: Fee is 2% per started 30-day period\n\nAC-2: No fee within a 5-day grace period";
  const issues = {
    "LEND-1": { id: "10001", key: "LEND-1", fields: { summary: "Late payment fee for consumer loans", description: v === 3 ? adf(story) : story, status: { name: "To Do" }, issuetype: { name: "Story" }, project: { key: "LEND" }, labels: ["fees"], subtasks: [] }, remotelinks: [], comments: [] },
  };
  const api = `/rest/api/${v}`;

  async function fetch(url, init) {
    const c = record(url, init);
    const expected = deployment === "cloud" ? "Basic " : "Bearer ";
    if (!c.auth?.startsWith(expected)) return respond(401, { errorMessages: ["unauthorized"] });
    let m;
    if (c.method === "GET" && (m = new RegExp(`^${api}/issue/([A-Z]+-\\d+)$`).exec(c.path))) {
      const i = issues[m[1]];
      return i ? respond(200, { id: i.id, key: i.key, fields: i.fields }) : respond(404, { errorMessages: ["Issue does not exist"] });
    }
    if (c.method === "GET" && new RegExp(`^${api}/issue/createmeta/[A-Z]+/issuetypes$`).test(c.path)) {
      const types = [{ id: "10001", name: "Story", subtask: false }, ...(subtaskTypes ? [{ id: "10003", name: "Subtask", subtask: true }] : [])];
      return respond(200, v === 3 ? { issueTypes: types } : { values: types });
    }
    if (c.method === "POST" && c.path === `${api}/issue`) {
      const f = c.body.fields;
      if (!f.parent?.key || !(f.issuetype?.id || f.issuetype?.name)) return respond(400, { errors: { parentId: "missing" } });
      if (v === 3 && typeof f.description !== "object") return respond(400, { errors: { description: "ADF required" } });
      const key = `LEND-${(next += 1)}`;
      issues[key] = { id: String(20000 + next), key, fields: { ...f, status: { name: "To Do" }, subtasks: [] }, remotelinks: [], comments: [] };
      issues[f.parent.key].fields.subtasks.push({ key, fields: { summary: f.summary, status: { name: "To Do" } } });
      return respond(201, { id: issues[key].id, key });
    }
    if (c.method === "POST" && (m = new RegExp(`^${api}/issue/([A-Z]+-\\d+)/comment$`).exec(c.path))) {
      issues[m[1]].comments.push(c.body.body);
      return respond(201, { id: String(issues[m[1]].comments.length) });
    }
    if (c.method === "POST" && (m = new RegExp(`^${api}/issue/([A-Z]+-\\d+)/remotelink$`).exec(c.path))) {
      issues[m[1]].remotelinks.push(c.body.object);
      return respond(201, { id: issues[m[1]].remotelinks.length });
    }
    if (c.method === "GET" && c.path === (v === 3 ? `${api}/search/jql` : `${api}/search`)) {
      return respond(200, { issues: Object.values(issues).map((i) => ({ key: i.key, fields: { summary: i.fields.summary, status: i.fields.status } })) });
    }
    return respond(404, { errorMessages: [`fake Jira: no route ${c.method} ${c.path}`] });
  }
  return { fetch, calls, issues };
}

// ------------------------------------------------------------------ GitHub Issues
export function fakeGitHubIssues({ repo = "acme/sandbox", subIssues = true } = {}) {
  const { calls, record } = recorder();
  let next = 1;
  let nextId = 5000;
  const issues = {
    1: { id: 4001, number: 1, title: "Late payment fee for consumer loans", state: "open", labels: [{ name: "story" }], html_url: `https://github.com/${repo}/issues/1`, body: "As a collections officer...\n\nAcceptance criteria\n- AC-1: Fee is 2% per started 30-day period\n- AC-2: No fee within a 5-day grace period", subs: [], comments: [] },
  };
  const base = `/repos/${repo}`;
  async function fetch(url, init) {
    const c = record(url, init);
    if (!c.auth?.startsWith("Bearer ")) return respond(401, { message: "Bad credentials" });
    let m;
    if (c.method === "GET" && (m = new RegExp(`^${base}/issues/(\\d+)$`).exec(c.path))) return issues[m[1]] ? respond(200, issues[m[1]]) : respond(404, { message: "Not Found" });
    if (c.method === "GET" && (m = new RegExp(`^${base}/issues/(\\d+)/sub_issues$`).exec(c.path))) {
      return subIssues ? respond(200, issues[m[1]].subs.map((n) => issues[n])) : respond(404, { message: "Not Found" });
    }
    if (c.method === "POST" && (m = new RegExp(`^${base}/issues/(\\d+)/sub_issues$`).exec(c.path))) {
      if (!subIssues) return respond(404, { message: "Not Found" });
      const child = Object.values(issues).find((i) => i.id === c.body.sub_issue_id);
      issues[m[1]].subs.push(child.number);
      return respond(201, issues[m[1]]);
    }
    if (c.method === "GET" && c.path === `${base}/issues`) return respond(200, Object.values(issues));
    if (c.method === "POST" && c.path === `${base}/issues`) {
      const number = (next += 1);
      issues[number] = { id: (nextId += 1), number, title: c.body.title, body: c.body.body, state: "open", labels: (c.body.labels ?? []).map((name) => ({ name })), html_url: `https://github.com/${repo}/issues/${number}`, subs: [], comments: [] };
      return respond(201, issues[number]);
    }
    if (c.method === "POST" && (m = new RegExp(`^${base}/issues/(\\d+)/comments$`).exec(c.path))) {
      issues[m[1]].comments.push(c.body.body);
      return respond(201, { id: 900 + issues[m[1]].comments.length, html_url: `${issues[m[1]].html_url}#comment` });
    }
    if (c.method === "GET" && c.path === "/search/issues") return respond(200, { items: Object.values(issues) });
    return respond(404, { message: `fake GitHub: no route ${c.method} ${c.path}` });
  }
  return { fetch, calls, issues };
}
