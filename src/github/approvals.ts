import type { GitHubClientLike } from "../contracts";

export interface ApprovalCheckOutcome {
  ok: boolean;
  approvers: string[];
  reason?: string;
}

export async function verifyRunApprovals(params: {
  github: GitHubClientLike;
  owner: string;
  repo: string;
  runId: number;
  prAuthorLogin: string;
}): Promise<ApprovalCheckOutcome> {
  if (!Number.isFinite(params.runId) || params.runId <= 0) {
    return {
      ok: false,
      approvers: [],
      reason: "Missing valid workflow run ID for approval verification.",
    };
  }

  const rawApprovers = await params.github.getRunApprovals(params.owner, params.repo, params.runId);
  const approvers = [...new Set(rawApprovers.map((a) => a.trim()).filter(Boolean))];
  if (approvers.length === 0) {
    return {
      ok: false,
      approvers: [],
      reason: "No deployment approvers recorded for this workflow run.",
    };
  }

  const authorLower = params.prAuthorLogin.trim().toLowerCase();
  const nonAuthorApprovers = authorLower ? approvers.filter((login) => login.toLowerCase() !== authorLower) : approvers;

  if (nonAuthorApprovers.length === 0) {
    return {
      ok: false,
      approvers,
      reason: `Self-approval by PR author "${params.prAuthorLogin}" is not permitted.`,
    };
  }

  return {
    ok: true,
    approvers: nonAuthorApprovers,
  };
}
