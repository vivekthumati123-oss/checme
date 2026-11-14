/** Port implemented by GitHub today and by GitLab / Bitbucket / Azure Repos later (SCMBridge). */
export class ScmProvider {
  async getPullRequest(number) { throw new Error("not implemented"); }
  async listChangedFiles(number) { throw new Error("not implemented"); }
  async listFiles(ref) { throw new Error("not implemented"); }
  async getFile(path, ref) { throw new Error("not implemented"); }
  async commitFiles({ branch, message, files }) { throw new Error("not implemented"); }
  async createPullRequest(input) { throw new Error("not implemented"); }
  async addPullRequestComment(number, body) { throw new Error("not implemented"); }
  async upsertPullRequestComment(number, marker, body) { throw new Error("not implemented"); }
  async publishCheck(input) { throw new Error("not implemented"); }
}
