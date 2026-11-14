import { ScmProvider } from "./scm-provider.js";

/** GitHub REST implementation using global fetch (Node 20+). Retries on rate limits. */
export class GitHubScmProvider extends ScmProvider {
  constructor({ owner, repo, token, baseUrl = process.env.GITHUB_API_URL ?? "https://api.github.com", logger = null, dryRun = false, fetch }) {
    super();
    if (!owner || !repo) throw new Error("owner and repo are required");
    Object.assign(this, { owner, repo, token: token ?? process.env.GITHUB_TOKEN, baseUrl: baseUrl.replace(/\/$/, ""), logger, dryRun, fetchImpl: fetch ?? globalThis.fetch });
  }

  async request(method, path, body, { retries = 3 } = {}) {
    if (!this.token) throw new Error("GITHUB_TOKEN is not set");
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const response = await this.fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "l2-agent-platform" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const limited = response.status === 429 || (response.status === 403 && response.headers?.get?.("x-ratelimit-remaining") === "0");
      if (limited && attempt < retries) {
        const wait = Number(response.headers.get("retry-after") ?? 2 ** attempt);
        this.logger?.warn?.("github.throttled", { waitSeconds: wait });
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if (!response.ok) throw new Error(`GitHub ${method} ${path} failed: ${response.status} ${(await response.text()).slice(0, 400)}`);
      return response.status === 204 ? null : response.json();
    }
    throw new Error(`GitHub ${method} ${path} exhausted retries`);
  }

  #repo(suffix = "") {
    return `/repos/${this.owner}/${this.repo}${suffix}`;
  }

  async getPullRequest(number) {
    const pr = await this.request("GET", this.#repo(`/pulls/${number}`));
    return { number: pr.number, title: pr.title, body: pr.body, baseBranch: pr.base.ref, headBranch: pr.head.ref, baseSha: pr.base.sha, headSha: pr.head.sha, author: pr.user?.login, labels: (pr.labels ?? []).map((l) => l.name) };
  }

  async listChangedFiles(number) {
    const files = [];
    for (let page = 1; page <= 30; page += 1) {
      const batch = await this.request("GET", this.#repo(`/pulls/${number}/files?per_page=100&page=${page}`));
      files.push(...batch);
      if (batch.length < 100) break;
    }
    return files.map((f) => ({ path: f.filename, status: f.status, previousPath: f.previous_filename, additions: f.additions, deletions: f.deletions, patch: f.patch }));
  }

  /** All file paths at a ref (default branch when omitted). */
  async listFiles(ref) {
    const branch = ref ?? (await this.request("GET", this.#repo())).default_branch;
    const tree = await this.request("GET", this.#repo(`/git/trees/${encodeURIComponent(branch)}?recursive=1`));
    return tree.tree.filter((t) => t.type === "blob").map((t) => t.path);
  }

  async getFile(path, ref) {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const file = await this.request("GET", this.#repo(`/contents/${path.split("/").map(encodeURIComponent).join("/")}${query}`));
    return Buffer.from(file.content, "base64").toString("utf8");
  }

  /** Create `branch` from the default branch if it does not exist yet. */
  async ensureBranch(branch) {
    try {
      await this.request("GET", this.#repo(`/git/ref/heads/${branch}`));
      return false;
    } catch {
      const repo = await this.request("GET", this.#repo());
      const base = await this.request("GET", this.#repo(`/git/ref/heads/${repo.default_branch}`));
      await this.request("POST", this.#repo("/git/refs"), { ref: `refs/heads/${branch}`, sha: base.object.sha });
      return true;
    }
  }

  async commitFiles({ branch, message, files }) {
    if (this.dryRun) return "dry-run";
    await this.ensureBranch(branch);
    let lastSha = null;
    for (const file of files) {
      let sha;
      try {
        sha = (await this.request("GET", this.#repo(`/contents/${file.path}?ref=${encodeURIComponent(branch)}`))).sha;
      } catch {
        sha = undefined;
      }
      const result = await this.request("PUT", this.#repo(`/contents/${file.path}`), { message, branch, sha, content: Buffer.from(file.content, "utf8").toString("base64") });
      lastSha = result.commit?.sha ?? lastSha;
    }
    return lastSha;
  }

  async createPullRequest({ title, body, baseBranch, headBranch, draft = true }) {
    if (this.dryRun) return { number: 0, url: "dry-run" };
    const pr = await this.request("POST", this.#repo("/pulls"), { title, body, base: baseBranch, head: headBranch, draft });
    return { number: pr.number, url: pr.html_url };
  }

  async addPullRequestComment(number, body) {
    if (this.dryRun) return;
    await this.request("POST", this.#repo(`/issues/${number}/comments`), { body });
  }

  async upsertPullRequestComment(number, marker, body) {
    if (this.dryRun) return;
    const comments = await this.request("GET", this.#repo(`/issues/${number}/comments?per_page=100`));
    const existing = comments.find((c) => c.body?.includes(marker));
    if (existing) await this.request("PATCH", this.#repo(`/issues/comments/${existing.id}`), { body });
    else await this.addPullRequestComment(number, body);
  }

  /** Check runs need a GitHub App token (including Actions' GITHUB_TOKEN); personal tokens get 403. */
  async publishCheck({ name, headSha, conclusion, title, summary, detailsUrl }) {
    if (this.dryRun) return;
    await this.request("POST", this.#repo("/check-runs"), { name, head_sha: headSha, status: "completed", conclusion, details_url: detailsUrl, output: { title, summary } });
  }
}
