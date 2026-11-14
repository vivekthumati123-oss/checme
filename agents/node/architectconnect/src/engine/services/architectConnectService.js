import { scanRepository } from "../repositoryScanner.js";
import { generateHLD } from "../hldGenerator.js";
import { generateStructurizr } from "../structurizrGenerator.js";
import { generateADRs } from "../adrGenerator.js";
import { loadRepository } from "./scmRepositoryLoader.js";
import { loadGitHubRepository } from "./githubRepositoryLoader.js";
import { createScmBridgeClient } from "./scmBridgeClient.js";

export function createArchitectureService({
  scanner = scanRepository, hldGenerator = generateHLD,
  dslGenerator = generateStructurizr, adrGenerator = generateADRs,
  repositoryLoader = loadRepository, githubLoader = loadGitHubRepository, client, octokit, token, logger,
} = {}) {
  function analyzeRepositoryContents(contents, packageContent = "", metadata = {}) {
    const findings = scanner(contents, packageContent);
    const architecture = findings.selectedArchitecture?.architecture ?? findings;
    const selectedFindings = { ...findings };
    for (const key of ["applications", "apis", "components", "relationships"]) {
      selectedFindings[key] = Array.isArray(architecture[key]) ? architecture[key] : findings[key];
    }
    const hld = hldGenerator(selectedFindings);
    const dsl = dslGenerator(selectedFindings);
    const adrs = adrGenerator(selectedFindings, metadata);
    logger?.debug?.("architectconnect.analysis.completed", {
      selectedSource: findings.selectedArchitecture?.source ?? "legacy",
      applications: selectedFindings.applications.length, components: selectedFindings.components.length,
    });
    return {
      repository: metadata.repository || null, branch: metadata.branch || null,
      treeSha: metadata.treeSha || null, findings, selectedFindings, hld, dsl, adrs,
    };
  }

  async function analyzeScmRepository(repositoryUrl) {
    const loaded = await repositoryLoader(repositoryUrl, { client });
    const result = analyzeRepositoryContents(loaded.contents, loaded.packageContent, {
      repository: loaded.repository.fullName, branch: loaded.ref, treeSha: null, provider: loaded.provider,
    });
    return {
      ...result,
      source: { type: "scm", provider: loaded.provider, repositoryUrl, repository: loaded.repository.fullName, branch: loaded.ref },
      acquisition: { selectedFiles: loaded.selectedPaths.length, loadedFiles: loaded.contents.length, missingPaths: loaded.missingPaths ?? [] },
    };
  }
  async function analyzeGitHubRepository(owner, repo) {
    const loaded = await githubLoader(owner, repo, { octokit, token });
    return {
      ...analyzeRepositoryContents(loaded.contents, loaded.packageContent, loaded.metadata),
      source: { type: "github-direct", provider: "github", repository: loaded.metadata.repository, branch: loaded.metadata.branch },
      acquisition: { selectedFiles: loaded.selectedPaths.length, loadedFiles: loaded.selectedPaths.length - loaded.missingPaths.length, missingPaths: loaded.missingPaths, treeTruncated: loaded.treeTruncated },
    };
  }
  return { analyzeRepositoryContents, analyzeScmRepository, analyzeGitHubRepository };
}

export function analyzeRepositoryContents(contents, packageContent = "", metadata = {}) {
  return createArchitectureService().analyzeRepositoryContents(contents, packageContent, metadata);
}

export function analyzeGitHubRepository(owner, repo, options = {}) {
  return createArchitectureService(options).analyzeGitHubRepository(owner, repo);
}

export function analyzeScmRepository(repositoryUrl, options = {}) {
  const client = options.client ?? createScmBridgeClient({ baseUrl: process.env.SCM_BRIDGE_URL ?? "http://localhost:3000" });
  return createArchitectureService({ ...options, client }).analyzeScmRepository(repositoryUrl);
}