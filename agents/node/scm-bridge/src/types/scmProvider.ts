import { ScmProviderType } from "./scmProviderType";
import { ScmRepository } from "./scmRepository";
import { ScmRepositoryContent } from "./scmRepositoryContent";
import { ScmTreeItem } from "./scmTreeItem";
import { ScmBranch } from "./scmBranch";
import { ScmFileOperationResult } from "./scmFileOperationResult";
import { ScmCommit } from "./scmCommit";
import { ScmPullRequest } from "./scmPullRequest";
import { ScmWebhook } from "./scmWebhook";


export interface ScmProvider {

  readonly name: ScmProviderType;


  // =========================================================
  // FR-SCM-003: REPOSITORIES
  // =========================================================

  listRepositories(
  token: string,
  workspace?: string
): Promise<ScmRepository[]>;

getRepository(
  token: string,
  repositoryUrl: string
): Promise<ScmRepository>;
  // =========================================================
  // FR-SCM-004: REPOSITORY CONTENT
  // =========================================================

  getRepositoryContent(
    token: string,
    repositoryUrl: string,
    path?: string,
    ref?: string
  ): Promise<ScmRepositoryContent[]>;


  getRepositoryTree(
    token: string,
    repositoryUrl: string,
    ref?: string
  ): Promise<ScmTreeItem[]>;


  // =========================================================
  // FR-SCM-005: BRANCHES
  // =========================================================

  listBranches(
    token: string,
    repositoryUrl: string
  ): Promise<ScmBranch[]>;


  getBranch(
    token: string,
    repositoryUrl: string,
    branchName: string
  ): Promise<ScmBranch>;


  createBranch(
    token: string,
    repositoryUrl: string,
    branchName: string,
    fromRef: string
  ): Promise<ScmBranch>;


  // =========================================================
  // FR-SCM-006: FILES
  // =========================================================

  createFile(
    token: string,
    repositoryUrl: string,
    path: string,
    content: string,
    commitMessage: string,
    branch: string
  ): Promise<ScmFileOperationResult>;


  updateFile(
    token: string,
    repositoryUrl: string,
    path: string,
    content: string,
    commitMessage: string,
    branch: string
  ): Promise<ScmFileOperationResult>;


  // =========================================================
  // FR-SCM-007: COMMITS
  // =========================================================

  listCommits(
    token: string,
    repositoryUrl: string,
    ref?: string
  ): Promise<ScmCommit[]>;


  getCommit(
    token: string,
    repositoryUrl: string,
    commitSha: string
  ): Promise<ScmCommit>;


  createCommit?(
  token: string,
  repositoryUrl: string,
  branch: string,
  message: string
): Promise<ScmCommit>;


  // =========================================================
  // FR-SCM-008: PULL REQUESTS / MERGE REQUESTS
  // =========================================================

  listPullRequests(
    token: string,
    repositoryUrl: string,
    state?: "open" | "closed" | "all"
  ): Promise<ScmPullRequest[]>;


  getPullRequest(
    token: string,
    repositoryUrl: string,
    pullRequestNumber: number
  ): Promise<ScmPullRequest>;


  createPullRequest(
    token: string,
    repositoryUrl: string,
    title: string,
    sourceBranch: string,
    targetBranch: string,
    body?: string
  ): Promise<ScmPullRequest>;


  // =========================================================
  // FR-SCM-009: WEBHOOKS
  // =========================================================

  listWebhooks(
    token: string,
    repositoryUrl: string
  ): Promise<ScmWebhook[]>;
}