import { ScmProvider } from "./scm-provider.js";

/** Test double that records every write. `failChecks` simulates a PAT that cannot create check runs. */
export class InMemoryScmProvider extends ScmProvider {
  constructor({ pullRequest, changedFiles = [], files = {}, failChecks = false } = {}) {
    super();
    this.pullRequest = pullRequest ?? { number: 1, title: "Sample", body: "", baseBranch: "main", headBranch: "feature", baseSha: "base-sha", headSha: "head-sha", author: "dev", labels: [] };
    Object.assign(this, { changedFiles, files, failChecks, commits: [], comments: [], checks: [], pullRequests: [] });
  }

  async getPullRequest() { return this.pullRequest; }
  async listChangedFiles() { return this.changedFiles; }
  async listFiles() { return Object.keys(this.files).sort(); }
  async getFile(path) {
    if (!(path in this.files)) throw new Error(`File not found: ${path}`);
    return this.files[path];
  }
  async commitFiles(input) { this.commits.push(input); return `sha-${this.commits.length}`; }
  async createPullRequest(input) { this.pullRequests.push(input); return { number: 99, url: "memory://pr/99" }; }
  async addPullRequestComment(number, body) { this.comments.push({ number, body }); }
  async upsertPullRequestComment(number, marker, body) {
    const existing = this.comments.find((c) => c.number === number && c.body.includes(marker));
    if (existing) existing.body = body;
    else this.comments.push({ number, body });
  }
  async publishCheck(input) {
    if (this.failChecks) throw new Error("GitHub POST /check-runs failed: 403 Resource not accessible by personal access token");
    this.checks.push(input);
  }
}
