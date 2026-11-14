export class ScmBridgeError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ScmBridgeError";
    this.status = status;
  }
}

export function validateRepositoryUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new ScmBridgeError("A full HTTPS repository URL is required."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new ScmBridgeError("Repository URL must use HTTPS without credentials, query parameters, or fragments.");
  }
  return url.href;
}

export function createScmBridgeClient({ baseUrl = "http://localhost:3000", fetchImpl = globalThis.fetch } = {}) {
  let base;
  try { base = new URL(baseUrl); } catch { throw new ScmBridgeError("SCM Bridge URL is invalid. Configure an HTTP(S) service URL."); }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new ScmBridgeError("SCM Bridge URL must be HTTP(S) without embedded credentials.");
  }

  async function request(endpoint, parameters = {}) {
    const url = new URL(endpoint, base);
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    let response;
    try { response = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" } }); }
    catch { throw new ScmBridgeError("SCM Bridge is unreachable. Check its URL and service availability."); }
    if (!response.ok) throw new ScmBridgeError(`SCM Bridge request failed with HTTP ${response.status}. Check bridge configuration and repository access.`, response.status);
    try { return await response.json(); }
    catch { throw new ScmBridgeError("SCM Bridge returned invalid JSON."); }
  }

  const getRepository = (repositoryUrl) => {
    validateRepositoryUrl(repositoryUrl);
    return request("/api/scm/repository", { repositoryUrl });
  };
  const getTree = (repositoryUrl, ref) => request("/api/scm/tree", { repositoryUrl, ref });
  const getContent = (repositoryUrl, filePath, ref) => request("/api/scm/content", { repositoryUrl, path: filePath, ref });

  async function getArchitectureContext(repositoryUrl) {
    validateRepositoryUrl(repositoryUrl);
    const response = await getRepository(repositoryUrl);
    const repository = response.repository;
    if (!repository) throw new ScmBridgeError("SCM Bridge did not return repository metadata.");
    const ref = repository.defaultBranch;
    if (!ref) throw new ScmBridgeError("Repository default branch is not available.");
    const treeResponse = await getTree(repositoryUrl, ref);
    if (!Array.isArray(treeResponse.tree)) throw new ScmBridgeError("SCM Bridge did not return a repository tree array.");
    return { provider: response.provider, repository, ref, tree: treeResponse.tree };
  }

  async function getFiles(repositoryUrl, paths, ref) {
    const files = [];
    for (const filePath of paths) {
      try {
        const response = await getContent(repositoryUrl, filePath, ref);
        const file = response.content?.[0];
        if (file) files.push(file);
      } catch (error) {
        if (error instanceof ScmBridgeError && error.status === 404) continue;
        throw error;
      }
    }
    return files;
  }

  return {
    getRepository, getTree, getContent, getArchitectureContext, getFiles,
    listRepositories: (provider, workspace) => request("/api/scm/repositories", { provider, workspace }),
    listBranches: (repositoryUrl) => request("/api/scm/branches", { repositoryUrl }),
    listCommits: (repositoryUrl, ref) => request("/api/scm/commits", { repositoryUrl, ref }),
    listPullRequests: (repositoryUrl, state = "open") => request("/api/scm/pull-requests", { repositoryUrl, state }),
  };
}