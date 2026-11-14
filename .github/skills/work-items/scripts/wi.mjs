#!/usr/bin/env node
/**
 * Work item client for GitHub Issues, Jira (Cloud and Data Center) and Azure DevOps Boards.
 *
 * One self-contained file (Node 20+, no dependencies) used in two ways:
 *   1. As a CLI from VS Code chat / Copilot CLI through the `work-items` skill (no MCP needed).
 *   2. As a library: `@l2/work-items` re-exports this file for the L2 agents.
 *
 * Every provider implements the same interface:
 *   getWorkItem(id) · getChildren(id) · createChildItems(parentId, items)
 *   addComment(id, text) · addLink(id, url, relation) · search(query, { limit })
 * and returns normalised work items:
 *   { provider, id, ref, type, title, description, acceptanceCriteria[], state, parentId, assignee, tags[], url }
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ============================================================ environment

/** Load KEY=VALUE pairs from `.env.local` in `start` or a parent folder. Existing env vars win. */
export function loadEnvFile({ start = process.cwd(), file = process.env.L2_ENV_FILE, env = process.env } = {}) {
  let target = file ? path.resolve(file) : null;
  if (!target) {
    let dir = path.resolve(start);
    for (; ;) {
      const candidate = path.join(dir, ".env.local");
      if (existsSync(candidate)) {
        target = candidate;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  if (!target || !existsSync(target)) return null;
  for (const line of readFileSync(target, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trim().startsWith("#")) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (env[match[1]] === undefined || env[match[1]] === "") env[match[1]] = value;
  }
  return target;
}

// ============================================================ text helpers

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

export function htmlToText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/\s*(p|div|h[1-6]|ul|ol|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) : m))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain text (with "- " bullets) to simple HTML for Azure DevOps rich-text fields. */
export function textToHtml(text) {
  const blocks = String(text ?? "").trim().split(/\n\s*\n/);
  return blocks
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${escapeHtml(l.replace(/^\s*[-*]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      return `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
    })
    .join("");
}

/** Atlassian Document Format (Jira Cloud v3) to plain text. */
export function adfToText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  const children = (node.content ?? []).map(adfToText);
  switch (node.type) {
    case "text": return node.text ?? "";
    case "hardBreak": return "\n";
    case "paragraph":
    case "heading": return `${children.join("")}\n\n`;
    case "listItem": return `- ${children.join("").trim()}\n`;
    case "bulletList":
    case "orderedList": return `${children.join("")}\n`;
    case "codeBlock": return `${children.join("")}\n\n`;
    default: return children.join("");
  }
}

/** Plain text (with "- " bullets) to ADF for Jira Cloud. */
export function textToAdf(text) {
  const content = [];
  for (const block of String(text ?? "").trim().split(/\n\s*\n/).filter(Boolean)) {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      content.push({
        type: "bulletList",
        content: lines.map((l) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: l.replace(/^\s*[-*]\s+/, "") }] }] })),
      });
    } else {
      const inline = [];
      lines.forEach((l, i) => {
        if (i) inline.push({ type: "hardBreak" });
        if (l) inline.push({ type: "text", text: l });
      });
      content.push({ type: "paragraph", content: inline });
    }
  }
  return { type: "doc", version: 1, content: content.length ? content : [{ type: "paragraph", content: [] }] };
}

/** Pull acceptance criteria out of free text: a section headed "Acceptance criteria", or AC-n lines. */
export function extractAcceptanceCriteria(text) {
  const items = [];
  let inSection = false;
  let blank = false;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (/^#*\s*\**acceptance criteria\**\s*:?\s*$/i.test(line)) {
      inSection = true;
      blank = false;
      continue;
    }
    if (!line) {
      blank = true;
      continue;
    }
    const bullet = /^(?:[-*]|\d+[.)])\s+(.*)$/.exec(line);
    const ac = /^(AC-?\d+\s*[:.)-].*)$/i.exec(line);
    if (inSection) {
      if (/^#+\s/.test(line) || (!bullet && !ac && items.length && blank)) break;
      items.push((bullet ? bullet[1] : line).trim());
    } else if (ac) items.push(ac[1].trim());
    blank = false;
  }
  return items.filter(Boolean);
}

// ============================================================ HTTP

export class WorkItemError extends Error {
  constructor(message, { status = null, provider = null } = {}) {
    super(message);
    this.name = "WorkItemError";
    this.status = status;
    this.provider = provider;
  }
}

function redact(text, secrets) {
  let out = String(text ?? "");
  for (const s of secrets.filter((x) => x && x.length > 6)) out = out.split(s).join("***");
  return out.slice(0, 600);
}

async function http(ctx, method, url, { body, headers = {}, raw = false, retry = true } = {}) {
  const fetchImpl = ctx.fetch ?? globalThis.fetch;
  const isPatch = headers["Content-Type"] === "application/json-patch+json";
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(url, {
      method,
      headers: { Accept: "application/json", "User-Agent": "l2-work-items", ...ctx.headers, ...(body !== undefined && !isPatch ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (retry && (response.status === 429 || response.status === 503) && attempt < 3) {
      const wait = Math.min(Number(response.headers?.get?.("retry-after") ?? 2 ** attempt), 30);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!response.ok) {
      const detail = redact(await response.text(), ctx.secrets);
      const hint = response.status === 401 ? " (check the token and its scopes)" : response.status === 403 ? " (token lacks permission, or SSO/IP policy)" : response.status === 404 ? " (wrong ID/project, or no access)" : "";
      throw new WorkItemError(`${ctx.name} ${method} ${redact(url, ctx.secrets)} failed: ${response.status}${hint} ${detail}`, { status: response.status, provider: ctx.name });
    }
    if (raw) return response;
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
}

const required = (provider, values) => {
  const missing = Object.entries(values).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new WorkItemError(`${provider}: missing configuration ${missing.join(", ")}. See references/setup.md.`, { provider });
};

const estimateLine = (h) => (h ? `\n\nEstimate: ${h}h` : "");

// ============================================================ GitHub Issues

export class GitHubIssuesProvider {
  constructor({ repo, token, apiUrl = "https://api.github.com", fetch } = {}) {
    required("github", { WORK_ITEMS_GITHUB_REPO: repo, "WORK_ITEMS_GITHUB_TOKEN or GITHUB_TOKEN": token });
    this.name = "github";
    this.repo = repo;
    this.apiUrl = apiUrl.replace(/\/$/, "");
    this.ctx = { name: "github", fetch, secrets: [token], headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } };
  }

  #url(p) {
    return `${this.apiUrl}/repos/${this.repo}${p}`;
  }

  #number(id) {
    const n = String(id).replace(/^.*#/, "");
    if (!/^\d+$/.test(n)) throw new WorkItemError(`github: invalid issue number "${id}"`, { provider: "github" });
    return n;
  }

  #normalise(i) {
    const body = i.body ?? "";
    return {
      provider: "github", id: String(i.number), ref: `github:${this.repo}#${i.number}`,
      type: i.pull_request ? "pull-request" : "issue", title: i.title, description: body,
      acceptanceCriteria: extractAcceptanceCriteria(body), state: i.state,
      parentId: /Parent: #(\d+)/.exec(body)?.[1] ?? null, assignee: i.assignee?.login ?? null,
      tags: (i.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)), url: i.html_url,
    };
  }

  async getWorkItem(id) {
    return this.#normalise(await http(this.ctx, "GET", this.#url(`/issues/${this.#number(id)}`)));
  }

  async getChildren(id) {
    const n = this.#number(id);
    const found = new Map();
    try {
      for (const i of await http(this.ctx, "GET", this.#url(`/issues/${n}/sub_issues?per_page=100`))) found.set(String(i.number), i);
    } catch (error) {
      if (![404, 410, 422].includes(error.status)) throw error;
    }
    const marker = new RegExp(`Parent: #${n}(?!\\d)`);
    for (const i of await http(this.ctx, "GET", this.#url("/issues?state=all&per_page=100"))) {
      if (!i.pull_request && marker.test(i.body ?? "")) found.set(String(i.number), i);
    }
    return [...found.values()].map((i) => ({ id: String(i.number), title: i.title, state: i.state, url: i.html_url }));
  }

  async createChildItems(parentId, items) {
    const parent = this.#number(parentId);
    const created = [];
    for (const item of items) {
      const issue = await http(this.ctx, "POST", this.#url("/issues"), {
        body: { title: item.title, body: `${item.description ?? ""}${estimateLine(item.estimate)}\n\nParent: #${parent}`, labels: item.tags ?? [] },
      });
      try {
        await http(this.ctx, "POST", this.#url(`/issues/${parent}/sub_issues`), { body: { sub_issue_id: issue.id } });
      } catch {
        // Sub-issues not available: the "Parent: #n" marker in the body still links them.
      }
      created.push({ id: String(issue.number), url: issue.html_url });
    }
    return created;
  }

  async addComment(id, text) {
    const c = await http(this.ctx, "POST", this.#url(`/issues/${this.#number(id)}/comments`), { body: { body: text } });
    return { id: String(c.id), url: c.html_url };
  }

  async addLink(id, url, relation = "link") {
    return this.addComment(id, `Linked ${relation}: ${url}`);
  }

  async search(query, { limit = 10 } = {}) {
    const q = encodeURIComponent(`repo:${this.repo} is:issue ${query}`);
    const data = await http(this.ctx, "GET", `${this.apiUrl}/search/issues?q=${q}&per_page=${limit}`);
    return data.items.map((i) => ({ id: String(i.number), title: i.title, state: i.state, url: i.html_url }));
  }
}

// ============================================================ Jira (Cloud v3 / Data Center v2)

export class JiraProvider {
  constructor({ baseUrl, email, apiToken, pat, deployment, project, subtaskType, acceptanceField, fetch } = {}) {
    this.name = "jira";
    this.deployment = deployment ?? (pat && !email ? "datacenter" : "cloud");
    if (this.deployment === "cloud") required("jira", { JIRA_BASE_URL: baseUrl, JIRA_EMAIL: email, JIRA_API_TOKEN: apiToken });
    else required("jira", { JIRA_BASE_URL: baseUrl, JIRA_PAT: pat });
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.api = `${this.baseUrl}/rest/api/${this.deployment === "cloud" ? 3 : 2}`;
    this.project = project;
    this.subtaskType = subtaskType;
    this.acceptanceField = acceptanceField;
    const auth = this.deployment === "cloud" ? `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}` : `Bearer ${pat}`;
    this.ctx = { name: "jira", fetch, secrets: [apiToken, pat], headers: { Authorization: auth } };
  }

  get cloud() {
    return this.deployment === "cloud";
  }

  #text(value) {
    return this.cloud ? adfToText(value).trim() : String(value ?? "");
  }

  #rich(text) {
    return this.cloud ? textToAdf(text) : String(text ?? "");
  }

  async #raw(key) {
    const fields = ["summary", "description", "status", "issuetype", "parent", "labels", "assignee", "subtasks", "project", this.acceptanceField].filter(Boolean).join(",");
    return http(this.ctx, "GET", `${this.api}/issue/${encodeURIComponent(key)}?fields=${fields}`);
  }

  async getWorkItem(key) {
    const i = await this.#raw(key);
    const f = i.fields;
    const description = this.#text(f.description);
    const acField = this.acceptanceField ? this.#text(f[this.acceptanceField]) : "";
    return {
      provider: "jira", id: i.key, ref: `jira:${i.key}`, type: f.issuetype?.name ?? "issue", title: f.summary,
      description, acceptanceCriteria: extractAcceptanceCriteria(acField ? `Acceptance criteria\n${acField}` : description),
      state: f.status?.name ?? null, parentId: f.parent?.key ?? null, assignee: f.assignee?.displayName ?? null,
      tags: f.labels ?? [], url: `${this.baseUrl}/browse/${i.key}`,
    };
  }

  async getChildren(key) {
    const i = await this.#raw(key);
    return (i.fields.subtasks ?? []).map((s) => ({ id: s.key, title: s.fields?.summary ?? "", state: s.fields?.status?.name ?? null, url: `${this.baseUrl}/browse/${s.key}` }));
  }

  async #subtaskTypeFor(projectKey) {
    if (this.subtaskType) return { name: this.subtaskType };
    try {
      const data = await http(this.ctx, "GET", `${this.api}/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes?maxResults=100`);
      const types = data.issueTypes ?? data.values ?? [];
      const sub = types.find((t) => t.subtask);
      if (sub) return { id: String(sub.id) };
    } catch {
      // fall through to the conventional name
    }
    return { name: this.cloud ? "Subtask" : "Sub-task" };
  }

  async createChildItems(parentKey, items) {
    const parent = await this.#raw(parentKey);
    const projectKey = parent.fields.project?.key ?? parentKey.split("-")[0];
    const issuetype = await this.#subtaskTypeFor(projectKey);
    const created = [];
    for (const item of items) {
      const res = await http(this.ctx, "POST", `${this.api}/issue`, {
        body: {
          fields: {
            project: { key: projectKey }, parent: { key: parent.key }, issuetype, summary: item.title,
            description: this.#rich(`${item.description ?? ""}${estimateLine(item.estimate)}`),
            labels: (item.tags ?? []).map((t) => String(t).replace(/\s+/g, "-")),
          },
        },
      });
      created.push({ id: res.key, url: `${this.baseUrl}/browse/${res.key}` });
    }
    return created;
  }

  async addComment(key, text) {
    const c = await http(this.ctx, "POST", `${this.api}/issue/${encodeURIComponent(key)}/comment`, { body: { body: this.#rich(text) } });
    return { id: String(c.id), url: `${this.baseUrl}/browse/${key}` };
  }

  async createWorkItem({ project = this.project, type, title, description = "", tags = [], parentId } = {}) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(project ?? "")) throw new WorkItemError("A valid Jira project key is required");
    if (!["Epic", "Story"].includes(type) || !String(title ?? "").trim()) throw new WorkItemError("Jira creation requires Epic or Story and a title");
    if (type === "Story" && !/^[A-Z][A-Z0-9_]*-\d+$/.test(parentId ?? "")) throw new WorkItemError("A Story requires an epic parent key");
    if (type === "Epic" && parentId) throw new WorkItemError("An Epic cannot have a parent in this workflow");
    const result = await http(this.ctx, "POST", `${this.api}/issue`, { retry: false, body: { fields: {
      project: { key: project }, issuetype: { name: type }, summary: title,
      description: this.#rich(description), labels: tags.map((tag) => String(tag).replace(/\s+/g, "-")),
      ...(parentId ? { parent: { key: parentId } } : {}),
    } } });
    if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(result?.key ?? "")) throw new WorkItemError("Jira creation returned no valid key; reconcile the remote outcome before retrying");
    return { id: result.key, url: `${this.baseUrl}/browse/${result.key}` };
  }

  async searchAll(jql) {
    const issues = [];
    const seen = new Set();
    let nextPageToken;
    let startAt = 0;
    for (;;) {
      const params = new URLSearchParams({ jql, maxResults: "100", fields: "summary,description,status,issuetype,parent,labels" });
      if (this.cloud && nextPageToken) params.set("nextPageToken", nextPageToken);
      if (!this.cloud) params.set("startAt", String(startAt));
      const data = await http(this.ctx, "GET", `${this.api}/${this.cloud ? "search/jql" : "search"}?${params}`);
      const page = data.issues ?? [];
      issues.push(...page.map((issue) => ({
        id: issue.key, title: issue.fields?.summary ?? "", description: this.#text(issue.fields?.description),
        type: issue.fields?.issuetype?.name ?? "issue", parentId: issue.fields?.parent?.key ?? null,
        tags: issue.fields?.labels ?? [], url: `${this.baseUrl}/browse/${issue.key}`,
      })));
      if (this.cloud) {
        if (!data.nextPageToken || data.isLast === true) break;
        if (seen.has(data.nextPageToken)) throw new WorkItemError("Jira returned a repeated pagination token");
        seen.add(data.nextPageToken);
        nextPageToken = data.nextPageToken;
      } else {
        startAt += page.length;
        if (!page.length || startAt >= (data.total ?? startAt)) break;
      }
    }
    return issues;
  }

  async getEpicChildren(key) {
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) throw new WorkItemError("A valid Jira epic key is required");
    return this.searchAll(`parent = "${key}" ORDER BY key ASC`);
  }

  async addLink(key, url, relation = "link") {
    await http(this.ctx, "POST", `${this.api}/issue/${encodeURIComponent(key)}/remotelink`, { body: { object: { url, title: `${relation}: ${url}` } } });
    return { id: key, url };
  }

  async search(query, { limit = 10 } = {}) {
    const isJql = /[=~]|\border by\b|\bin\s*\(/i.test(query);
    const escaped = query.replace(/"/g, '\\"');
    const jql = isJql ? query : `${this.project ? `project = "${this.project}" AND ` : ""}text ~ "${escaped}" ORDER BY updated DESC`;
    const params = `jql=${encodeURIComponent(jql)}&maxResults=${limit}&fields=summary,status,issuetype`;
    const data = await http(this.ctx, "GET", `${this.api}/${this.cloud ? "search/jql" : "search"}?${params}`);
    return (data.issues ?? []).map((i) => ({ id: i.key, title: i.fields?.summary, state: i.fields?.status?.name ?? null, url: `${this.baseUrl}/browse/${i.key}` }));
  }
}

// ============================================================ Azure DevOps Boards

const PATCH = { "Content-Type": "application/json-patch+json" };

export class AzureDevOpsProvider {
  constructor({ orgUrl, project, pat, childType = "Task", estimateField = "Microsoft.VSTS.Scheduling.RemainingWork", apiVersion = "7.1", fetch } = {}) {
    required("ado", { ADO_ORG_URL: orgUrl, ADO_PROJECT: project, ADO_PAT: pat });
    this.name = "ado";
    this.orgUrl = orgUrl.replace(/\/$/, "");
    this.project = project;
    this.childType = childType;
    this.estimateField = estimateField;
    this.v = apiVersion;
    this.base = `${this.orgUrl}/${encodeURIComponent(project)}/_apis/wit`;
    this.ctx = { name: "ado", fetch, secrets: [pat], headers: { Authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}` } };
  }

  #id(id) {
    const n = String(id).replace(/^.*[:/]/, "");
    if (!/^\d+$/.test(n)) throw new WorkItemError(`ado: invalid work item id "${id}"`, { provider: "ado" });
    return n;
  }

  async #raw(id) {
    return http(this.ctx, "GET", `${this.base}/workitems/${this.#id(id)}?$expand=relations&api-version=${this.v}`);
  }

  #normalise(w) {
    const f = w.fields;
    const description = htmlToText(f["System.Description"]);
    const ac = htmlToText(f["Microsoft.VSTS.Common.AcceptanceCriteria"]);
    return {
      provider: "ado", id: String(w.id), ref: `ado:${w.id}`, type: f["System.WorkItemType"], title: f["System.Title"],
      description, acceptanceCriteria: extractAcceptanceCriteria(ac ? `Acceptance criteria\n${ac}` : description),
      state: f["System.State"], parentId: f["System.Parent"] ? String(f["System.Parent"]) : null,
      assignee: f["System.AssignedTo"]?.displayName ?? null,
      tags: f["System.Tags"] ? f["System.Tags"].split(";").map((t) => t.trim()).filter(Boolean) : [],
      url: w._links?.html?.href ?? `${this.orgUrl}/${encodeURIComponent(this.project)}/_workitems/edit/${w.id}`,
    };
  }

  async #batch(ids, fields = ["System.Id", "System.Title", "System.State", "System.WorkItemType"]) {
    const out = [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200).join(",");
      const data = await http(this.ctx, "GET", `${this.base}/workitems?ids=${chunk}&fields=${fields.join(",")}&api-version=${this.v}`);
      out.push(...data.value);
    }
    return out.map((w) => ({ id: String(w.id), title: w.fields["System.Title"], state: w.fields["System.State"], type: w.fields["System.WorkItemType"], url: `${this.orgUrl}/${encodeURIComponent(this.project)}/_workitems/edit/${w.id}` }));
  }

  async getWorkItem(id) {
    return this.#normalise(await this.#raw(id));
  }

  async getChildren(id) {
    const w = await this.#raw(id);
    const ids = (w.relations ?? []).filter((r) => r.rel === "System.LinkTypes.Hierarchy-Forward").map((r) => r.url.split("/").pop());
    return ids.length ? this.#batch(ids) : [];
  }

  async createChildItems(parentId, items) {
    const parent = await this.#raw(parentId);
    const pf = parent.fields;
    const created = [];
    for (const item of items) {
      const ops = [
        { op: "add", path: "/fields/System.Title", value: item.title },
        { op: "add", path: "/fields/System.Description", value: textToHtml(item.description ?? "") },
        { op: "add", path: "/fields/System.AreaPath", value: pf["System.AreaPath"] },
        { op: "add", path: "/fields/System.IterationPath", value: pf["System.IterationPath"] },
        { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: `${this.orgUrl}/_apis/wit/workItems/${parent.id}` } },
      ];
      if (item.tags?.length) ops.push({ op: "add", path: "/fields/System.Tags", value: item.tags.join("; ") });
      if (item.estimate && this.estimateField) ops.push({ op: "add", path: `/fields/${this.estimateField}`, value: Number(item.estimate) });
      const w = await http(this.ctx, "POST", `${this.base}/workitems/$${encodeURIComponent(item.type ?? this.childType)}?api-version=${this.v}`, { body: ops, headers: PATCH });
      created.push({ id: String(w.id), url: w._links?.html?.href ?? `${this.orgUrl}/${encodeURIComponent(this.project)}/_workitems/edit/${w.id}` });
    }
    return created;
  }

  async addComment(id, text) {
    const c = await http(this.ctx, "POST", `${this.base}/workItems/${this.#id(id)}/comments?format=markdown&api-version=7.1-preview.4`, { body: { text } });
    return { id: String(c.id ?? c.commentId ?? ""), url: null };
  }

  async addLink(id, url, relation = "link") {
    await http(this.ctx, "PATCH", `${this.base}/workitems/${this.#id(id)}?api-version=${this.v}`, {
      body: [{ op: "add", path: "/relations/-", value: { rel: "Hyperlink", url, attributes: { comment: relation } } }],
      headers: PATCH,
    });
    return { id: this.#id(id), url };
  }

  async search(query, { limit = 10 } = {}) {
    const wiql = /^\s*select\b/i.test(query)
      ? query
      : `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Title] CONTAINS '${query.replace(/'/g, "''")}' ORDER BY [System.ChangedDate] DESC`;
    const data = await http(this.ctx, "POST", `${this.orgUrl}/${encodeURIComponent(this.project)}/_apis/wit/wiql?$top=${limit}&api-version=${this.v}`, { body: { query: wiql } });
    const ids = (data.workItems ?? []).slice(0, limit).map((w) => w.id);
    return ids.length ? this.#batch(ids) : [];
  }
}

// ============================================================ factory and router

export const PROVIDERS = ["github", "jira", "ado"];

export function createWorkItemProvider(name, env = process.env, { fetch, repo } = {}) {
  switch (String(name ?? "").toLowerCase()) {
    case "github":
      return new GitHubIssuesProvider({ repo: repo ?? env.WORK_ITEMS_GITHUB_REPO ?? env.GITHUB_REPOSITORY, token: env.WORK_ITEMS_GITHUB_TOKEN || env.GITHUB_TOKEN, apiUrl: env.GITHUB_API_URL || undefined, fetch });
    case "jira":
      return new JiraProvider({
        baseUrl: env.JIRA_BASE_URL, email: env.JIRA_EMAIL, apiToken: env.JIRA_API_TOKEN, pat: env.JIRA_PAT,
        deployment: env.JIRA_DEPLOYMENT || undefined, project: env.JIRA_PROJECT, subtaskType: env.JIRA_SUBTASK_TYPE,
        acceptanceField: env.JIRA_AC_FIELD, fetch,
      });
    case "ado":
    case "azure-devops":
      return new AzureDevOpsProvider({
        orgUrl: env.ADO_ORG_URL, project: env.ADO_PROJECT, pat: env.ADO_PAT, childType: env.ADO_CHILD_TYPE || undefined,
        estimateField: env.ADO_ESTIMATE_FIELD ?? undefined, fetch,
      });
    default:
      throw new WorkItemError(`Unknown work item provider "${name}". Use one of: ${PROVIDERS.join(", ")} (set WORK_ITEM_PROVIDER or prefix the reference, e.g. ado:123).`);
  }
}

/** Parse "ado:123", "jira:PROJ-1", "PROJ-1", "github:owner/repo#12", "#12", "123". */
export function parseRef(ref, defaultProvider) {
  const text = String(ref ?? "").trim();
  let m = /^(github|gh):(?:([\w.-]+\/[\w.-]+))?#?(\d+)$/i.exec(text);
  if (m) return { provider: "github", repo: m[2] ?? null, id: m[3] };
  m = /^(jira):([A-Z][A-Z0-9_]+-\d+)$/i.exec(text);
  if (m) return { provider: "jira", id: m[2].toUpperCase() };
  m = /^(ado|azure-devops|ab):#?(\d+)$/i.exec(text);
  if (m) return { provider: "ado", id: m[2] };
  if (/^[A-Z][A-Z0-9_]+-\d+$/.test(text)) return { provider: "jira", id: text };
  if (/^#\d+$/.test(text)) return { provider: "github", repo: null, id: text.slice(1) };
  if (/^\d+$/.test(text) && defaultProvider) return { provider: String(defaultProvider).toLowerCase() === "azure-devops" ? "ado" : String(defaultProvider).toLowerCase(), repo: null, id: text };
  throw new WorkItemError(`Cannot tell which system "${text}" belongs to. Use ado:123, jira:PROJ-1, github:#12, or set WORK_ITEM_PROVIDER.`);
}

/**
 * Routes calls by reference prefix to the right provider. IDs returned by the router are full
 * references (ado:123, jira:PROJ-1, github:owner/repo#12) so they can be passed straight back.
 */
export class WorkItemRouter {
  constructor({ env = process.env, defaultProvider = env.WORK_ITEM_PROVIDER, defaultRepo, fetch, providers = {} } = {}) {
    Object.assign(this, { env, defaultProvider, defaultRepo, fetch, cache: new Map(Object.entries(providers)) });
    this.name = "router";
  }

  resolve(ref) {
    const parsed = parseRef(ref, this.defaultProvider);
    const repo = parsed.provider === "github" ? parsed.repo ?? this.defaultRepo ?? this.env.WORK_ITEMS_GITHUB_REPO ?? this.env.GITHUB_REPOSITORY : null;
    const key = parsed.provider === "github" ? `github:${repo}` : parsed.provider;
    if (!this.cache.has(key)) this.cache.set(key, createWorkItemProvider(parsed.provider, this.env, { fetch: this.fetch, repo }));
    const provider = this.cache.get(key);
    const toRef = (id) => (parsed.provider === "github" ? `github:${provider.repo}#${id}` : `${parsed.provider}:${id}`);
    return { provider, id: parsed.id, toRef };
  }

  async getWorkItem(ref) {
    const { provider, id, toRef } = this.resolve(ref);
    const item = await provider.getWorkItem(id);
    return { ...item, id: toRef(item.id), parentId: item.parentId ? toRef(item.parentId) : null };
  }

  async getChildren(ref) {
    const { provider, id, toRef } = this.resolve(ref);
    return (await provider.getChildren(id)).map((c) => ({ ...c, id: toRef(c.id) }));
  }

  async createChildItems(ref, items) {
    const { provider, id, toRef } = this.resolve(ref);
    return (await provider.createChildItems(id, items)).map((c) => ({ ...c, id: toRef(c.id) }));
  }

  async createWorkItem(providerName, item) {
    if (providerName !== "jira") throw new WorkItemError("Epic/Story creation currently supports Jira only");
    const { provider, toRef } = this.resolve("jira:XX-1");
    const parentId = item.parentId ? parseRef(item.parentId).id : undefined;
    if (item.parentId && parseRef(item.parentId).provider !== "jira") throw new WorkItemError("Parent must be a Jira reference");
    const created = await provider.createWorkItem({ ...item, parentId });
    return { ...created, id: toRef(created.id) };
  }

  async searchAll(providerName, query) {
    if (providerName !== "jira") throw new WorkItemError("Paginated epic discovery currently supports Jira only");
    const { provider, toRef } = this.resolve("jira:XX-1");
    return (await provider.searchAll(query)).map((item) => ({ ...item, id: toRef(item.id), parentId: item.parentId ? toRef(item.parentId) : null }));
  }

  async getEpicChildren(ref) {
    const { provider, id, toRef } = this.resolve(ref);
    if (provider.name !== "jira") throw new WorkItemError("Epic children currently support Jira only");
    return (await provider.getEpicChildren(id)).map((item) => ({ ...item, id: toRef(item.id), parentId: item.parentId ? toRef(item.parentId) : null }));
  }

  async addComment(ref, text) {
    const { provider, id } = this.resolve(ref);
    return provider.addComment(id, text);
  }

  async addLink(ref, url, relation) {
    const { provider, id } = this.resolve(ref);
    return provider.addLink(id, url, relation);
  }

  async search(providerName, query, options) {
    const ref = providerName === "github" ? "github:#1" : providerName === "jira" ? "jira:X-1" : "ado:1";
    const { provider, toRef } = this.resolve(ref);
    return (await provider.search(query, options)).map((r) => ({ ...r, id: toRef(r.id) }));
  }
}

/** Which providers are configured (no secrets printed). */
export function describeConfig(env = process.env) {
  const set = (k) => (env[k] ? "set" : "missing");
  return {
    defaultProvider: env.WORK_ITEM_PROVIDER ?? null,
    github: { repo: env.WORK_ITEMS_GITHUB_REPO ?? env.GITHUB_REPOSITORY ?? "missing", token: env.WORK_ITEMS_GITHUB_TOKEN ? "set" : set("GITHUB_TOKEN"), apiUrl: env.GITHUB_API_URL ?? "https://api.github.com" },
    jira: { baseUrl: env.JIRA_BASE_URL ?? "missing", mode: env.JIRA_DEPLOYMENT ?? (env.JIRA_PAT && !env.JIRA_EMAIL ? "datacenter" : "cloud"), email: set("JIRA_EMAIL"), apiToken: set("JIRA_API_TOKEN"), pat: set("JIRA_PAT"), project: env.JIRA_PROJECT ?? null },
    ado: { orgUrl: env.ADO_ORG_URL ?? "missing", project: env.ADO_PROJECT ?? "missing", pat: set("ADO_PAT"), childType: env.ADO_CHILD_TYPE ?? "Task" },
  };
}

// ============================================================ CLI

const USAGE = `Usage: wi.mjs <command> [args]
  doctor                                   show configuration (no secrets)
  get <ref>                                fetch a work item
  children <ref>                           list child items
  epic-children <jira:KEY>                  list all direct epic children
  epics <PROJECT>                          list all Jira epics
  search <github|jira|ado> "<query>" [--limit 10]
  create-children <ref> --file tasks.json [--apply]
  comment <ref> "<text>" [--apply]
  link <ref> <url> [--relation pull-request] [--apply]
Refs: ado:123  jira:PROJ-1  PROJ-1  github:owner/repo#12  #12  123 (uses WORK_ITEM_PROVIDER)
Write commands are dry runs unless --apply is given.`;

export function readTasksFile(file) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const tasks = Array.isArray(data) ? data : data.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) throw new WorkItemError(`${file} has no tasks`);
  return tasks.map((t) => {
    if (!t.title) throw new WorkItemError(`${file}: every task needs a title`);
    const ac = t.acceptanceCriterionRef ? `\n\nCovers: ${t.acceptanceCriterionRef}` : "";
    return { title: t.title, description: `${t.description ?? ""}${ac}`.trim(), estimate: t.estimateHours ?? t.estimate, tags: t.tags ?? ["agent-generated"] };
  });
}

export async function runCli(argv, { env = process.env, fetch, out = (o) => process.stdout.write(`${JSON.stringify(o, null, 2)}\n`) } = {}) {
  const flags = {};
  const args = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--apply") flags.apply = true;
    else if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[(i += 1)];
    else args.push(argv[i]);
  }
  const [command, ...rest] = args;
  const router = new WorkItemRouter({ env, fetch });
  const dry = (action, details) => out({ dryRun: true, action, ...details, next: "Re-run with --apply after the user confirms." });

  switch (command) {
    case "doctor":
      return out(describeConfig(env));
    case "get":
      return out(await router.getWorkItem(rest[0]));
    case "children":
      return out(await router.getChildren(rest[0]));
    case "epic-children":
      return out(await router.getEpicChildren(rest[0]));
    case "epics": {
      const project = rest[0] ?? env.JIRA_PROJECT;
      if (!/^[A-Z][A-Z0-9_]*$/.test(project ?? "")) throw new WorkItemError("epics requires a Jira project key");
      return out(await router.searchAll("jira", `project = "${project}" AND issuetype = Epic ORDER BY key ASC`));
    }
    case "search":
      return out(await router.search(rest[0], rest[1] ?? "", { limit: Number(flags.limit ?? 10) }));
    case "create-children": {
      if (!flags.file) throw new WorkItemError("create-children needs --file <tasks.json>");
      const tasks = readTasksFile(flags.file);
      const existing = new Set((await router.getChildren(rest[0])).map((c) => String(c.title).toLowerCase()));
      const fresh = tasks.filter((t) => !existing.has(t.title.toLowerCase()));
      const skipped = tasks.length - fresh.length;
      if (!flags.apply) return dry("create-children", { parent: rest[0], toCreate: fresh.map((t) => ({ title: t.title, estimate: t.estimate })), skippedExisting: skipped });
      return out({ parent: rest[0], created: fresh.length ? await router.createChildItems(rest[0], fresh) : [], skippedExisting: skipped });
    }
    case "comment":
      if (!flags.apply) return dry("comment", { target: rest[0], text: rest[1] });
      return out(await router.addComment(rest[0], rest[1]));
    case "link":
      if (!flags.apply) return dry("link", { target: rest[0], url: rest[1], relation: flags.relation ?? "link" });
      return out(await router.addLink(rest[0], rest[1], flags.relation ?? "link"));
    default:
      throw new WorkItemError(USAGE);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  loadEnvFile();
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
