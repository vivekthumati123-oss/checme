import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";

import type { GitHubClientLike } from "../contracts";

export interface OctokitClientOptions {
  githubToken: string;
  baseUrl?: string;
}

interface ApprovalEnvironmentEntry {
  state?: string;
  user?: { login?: string | null } | null;
}

function getHttpStatus(err: unknown): number {
  if (err && typeof err === "object") {
    const rec = err as { status?: unknown; response?: { status?: unknown } };
    if (typeof rec.status === "number") return rec.status;
    if (typeof rec.response?.status === "number") return rec.response.status;
  }
  return 0;
}

export class OctokitGitHubClient implements GitHubClientLike {
  private readonly octokit: Octokit;
  private readonly gql: typeof graphql;

  constructor(opts: OctokitClientOptions) {
    this.octokit = new Octokit({
      auth: opts.githubToken,
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
    });
    this.gql = graphql.defaults({
      headers: {
        authorization: `token ${opts.githubToken}`,
      },
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
    });
  }

  async getPullRequest(
    owner: string,
    repo: string,
    pr: number,
  ): Promise<{
    headSha: string;
    headRef: string;
    headRepoFullName: string;
    baseRepoFullName: string;
    draft: boolean;
    authorLogin: string;
    authorType: string;
    labels: string[];
    headCommitMessage: string;
  }> {
    const { data } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: pr,
    });

    let headCommitMessage: string;
    try {
      const commitRes = await this.octokit.repos.getCommit({
        owner,
        repo,
        ref: data.head.sha,
      });
      headCommitMessage = commitRes.data.commit.message ?? "";
    } catch {
      headCommitMessage = "";
    }

    return {
      headSha: data.head.sha,
      headRef: data.head.ref,
      headRepoFullName: data.head.repo?.full_name ?? `${owner}/${repo}`,
      baseRepoFullName: data.base.repo.full_name,
      draft: Boolean(data.draft),
      authorLogin: data.user?.login ?? "",
      authorType: data.user?.type ?? "User",
      labels: (data.labels ?? [])
        .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
        .filter((name) => name.length > 0),
      headCommitMessage,
    };
  }

  async listIssueComments(
    owner: string,
    repo: string,
    pr: number,
  ): Promise<Array<{ id: number; body: string; userLogin: string }>> {
    const comments = await this.octokit.paginate(this.octokit.issues.listComments, {
      owner,
      repo,
      issue_number: pr,
      per_page: 100,
    });
    return comments.map((c) => ({
      id: c.id,
      body: c.body ?? "",
      userLogin: c.user?.login ?? "",
    }));
  }

  async createIssueComment(owner: string, repo: string, pr: number, body: string): Promise<{ id: number }> {
    const { data } = await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: pr,
      body,
    });
    return { id: data.id };
  }

  async updateIssueComment(owner: string, repo: string, commentId: number, body: string): Promise<void> {
    await this.octokit.issues.updateComment({
      owner,
      repo,
      comment_id: commentId,
      body,
    });
  }

  async getEnvironment(
    owner: string,
    repo: string,
    environmentName: string,
  ): Promise<{
    exists: boolean;
    status: number;
    hasRequiredReviewers: boolean;
  }> {
    try {
      const { data, status } = await this.octokit.repos.getEnvironment({
        owner,
        repo,
        environment_name: environmentName,
      });
      const rules = (data.protection_rules ?? []) as Array<{
        type?: string;
        reviewers?: unknown[];
      }>;
      const hasRequiredReviewers = rules.some(
        (rule) => rule.type === "required_reviewers" && (!Array.isArray(rule.reviewers) || rule.reviewers.length > 0),
      );
      return {
        exists: true,
        status,
        hasRequiredReviewers,
      };
    } catch (err) {
      const status = getHttpStatus(err);
      if (status === 404) {
        return { exists: false, status: 404, hasRequiredReviewers: false };
      }
      if (status === 403 || status === 401) {
        return { exists: false, status: 403, hasRequiredReviewers: false };
      }
      throw err;
    }
  }

  async getRunApprovals(owner: string, repo: string, runId: number): Promise<string[]> {
    const res = await this.octokit.request("GET /repos/{owner}/{repo}/actions/runs/{run_id}/approvals", {
      owner,
      repo,
      run_id: runId,
    });
    const entries = Array.isArray(res.data) ? (res.data as ApprovalEnvironmentEntry[]) : [];
    const logins = new Set<string>();
    for (const entry of entries) {
      if (entry.state === "approved" && entry.user?.login) {
        logins.add(entry.user.login);
      }
    }
    return [...logins];
  }

  async createCommitOnBranch(params: {
    repositoryNameWithOwner: string;
    branchName: string;
    expectedHeadOid: string;
    headline: string;
    body: string;
    additions: Array<{ path: string; contentsBase64: string }>;
  }): Promise<{ oid: string }> {
    const mutation = `
      mutation UnitAgentCreateCommit($input: CreateCommitOnBranchInput!) {
        createCommitOnBranch(input: $input) {
          commit {
            oid
          }
        }
      }
    `;
    const result = await this.gql<{
      createCommitOnBranch?: {
        commit?: {
          oid?: string;
        } | null;
      } | null;
    }>(mutation, {
      input: {
        branch: {
          repositoryNameWithOwner: params.repositoryNameWithOwner,
          branchName: params.branchName,
        },
        expectedHeadOid: params.expectedHeadOid,
        fileChanges: {
          additions: params.additions.map((a) => ({
            path: a.path,
            contents: a.contentsBase64,
          })),
        },
        message: {
          headline: params.headline,
          body: params.body,
        },
      },
    });
    const oid = result.createCommitOnBranch?.commit?.oid;
    if (!oid) {
      throw new Error("GraphQL createCommitOnBranch returned no commit OID.");
    }
    return { oid };
  }
}

export function resolveGitHubTokensFromEnv(commitAuth: "github_token" | "pat" = "github_token"): {
  githubToken?: string;
  commitToken?: string;
} {
  const githubToken = process.env.GITHUB_TOKEN?.trim() || undefined;
  const patToken = process.env.UA_COMMIT_TOKEN?.trim() || process.env.COMMIT_PAT?.trim() || undefined;
  const commitToken = commitAuth === "pat" ? (patToken ?? githubToken) : (patToken ?? githubToken);
  return { githubToken, commitToken };
}

export function createGitHubClientsFromEnv(commitAuth: "github_token" | "pat" = "github_token"): {
  github?: OctokitGitHubClient;
  commitGithub?: OctokitGitHubClient;
} {
  const { githubToken, commitToken } = resolveGitHubTokensFromEnv(commitAuth);
  const apiUrl = process.env.GITHUB_API_URL?.trim() || undefined;
  const github = githubToken ? new OctokitGitHubClient({ githubToken, baseUrl: apiUrl }) : undefined;
  const commitGithub = commitToken
    ? commitToken === githubToken && github
      ? github
      : new OctokitGitHubClient({ githubToken: commitToken, baseUrl: apiUrl })
    : github;
  return { github, commitGithub };
}
