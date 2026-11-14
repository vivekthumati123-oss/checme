import { isArchitectureRelevant, isSafeRepositoryPath } from "./architectureFileSelector.js";
import { normalizeContents } from "./scmRepositoryLoader.js";

export class GitHubAcquisitionError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GitHubAcquisitionError";
    this.status = status;
  }
}

export function parseGitHubRepository(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new GitHubAcquisitionError("Direct GitHub analysis requires OWNER/REPOSITORY, without credentials or URL parameters.");
  }
  const [owner, repo] = value.split("/");
  if ([owner, repo].some((part) => part === "." || part === "..")) throw new GitHubAcquisitionError("GitHub owner and repository names must not be path traversal segments.");
  return { owner, repo };
}

export async function loadGitHubRepository(owner, repo, { octokit, token = process.env.GITHUB_TOKEN } = {}) {
  parseGitHubRepository(`${owner}/${repo}`);
  if (!octokit) {
    if (!token) throw new GitHubAcquisitionError("Direct GitHub analysis requires GITHUB_TOKEN or an injected authenticated Octokit client.");
    const { Octokit } = await import("@octokit/rest");
    octokit = new Octokit({ auth: token, log: { debug() {}, info() {}, warn() {}, error() {} } });
  }
  let repository;
  let branch;
  let tree;
  try {
    repository = (await octokit.repos.get({ owner, repo })).data;
    if (!repository.default_branch) throw new GitHubAcquisitionError("GitHub repository has no default branch.");
    branch = (await octokit.repos.getBranch({ owner, repo, branch: repository.default_branch })).data;
    const treeSha = branch.commit?.commit?.tree?.sha;
    if (!treeSha) throw new GitHubAcquisitionError("GitHub default branch did not return a tree SHA.");
    tree = (await octokit.git.getTree({ owner, repo, tree_sha: treeSha, recursive: "true" })).data;
    if (!Array.isArray(tree.tree)) throw new GitHubAcquisitionError("GitHub did not return a repository tree array.");
  } catch (error) {
    if (error instanceof GitHubAcquisitionError) throw error;
    throw new GitHubAcquisitionError("GitHub acquisition failed. Check network availability, credentials, and repository access.", error.status);
  }
  const contents = normalizeContents(tree.tree.filter((file) => file.type === "blob" && isSafeRepositoryPath(file.path))
    .map((file) => ({ ...file, type: "file", content: "" })));
  const relevant = contents.filter((file) => isArchitectureRelevant(file.path) || /(^|\/)yarn\.lock$|\.dockerfile$/i.test(file.path));
  const missingPaths = [];
  for (const file of relevant) {
    try {
      const blob = (await octokit.git.getBlob({ owner, repo, file_sha: file.sha })).data;
      if (typeof blob.content !== "string") throw new GitHubAcquisitionError("GitHub blob content is unavailable.");
      const encoding = blob.encoding ?? "base64";
      if (!["base64", "utf8", "utf-8"].includes(encoding)) throw new GitHubAcquisitionError("GitHub blob encoding is unsupported.");
      file.content = Buffer.from(blob.content, encoding).toString("utf8");
    } catch {
      missingPaths.push(file.path);
    }
  }
  return {
    contents, packageContent: contents.find((file) => file.path.toLowerCase() === "package.json")?.content ?? "",
    metadata: { repository: `${owner}/${repo}`, branch: repository.default_branch, treeSha: branch.commit.commit.tree.sha },
    selectedPaths: relevant.map((file) => file.path), missingPaths, treeTruncated: Boolean(tree.truncated),
  };
}