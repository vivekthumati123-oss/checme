import type { GitHubClientLike } from "../contracts";
import { DEFAULT_APPROVAL_ENVIRONMENT } from "./environments";

export interface ApprovalCheckOutcome {
  ok: boolean;
  approvers: string[];
  reason?: string;
}

/**
 * Verify run deployment approvers, honoring the environment's `prevent_self_review` rule.
 */
export async function verifyRunApprovals(params: {
  github: GitHubClientLike;
  owner: string;
  repo: string;
  runId: number;
  prAuthorLogin: string;
  environmentName?: string;
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

  if (nonAuthorApprovers.length > 0) {
    return {
      ok: true,
      approvers: nonAuthorApprovers,
    };
  }

  // Only allow PR-author self-approval when the environment positively permits it.
  const envName = params.environmentName ?? DEFAULT_APPROVAL_ENVIRONMENT;
  let envInfo: Awaited<ReturnType<GitHubClientLike["getEnvironment"]>>;
  try {
    envInfo = await params.github.getEnvironment(params.owner, params.repo, envName);
  } catch {
    return {
      ok: false,
      approvers,
      reason: `Self-approval by PR author "${params.prAuthorLogin}" is not permitted (could not verify environment "${envName}").`,
    };
  }

  if (envInfo.exists && envInfo.hasRequiredReviewers && envInfo.preventSelfReview === false) {
    return {
      ok: true,
      approvers,
    };
  }

  return {
    ok: false,
    approvers,
    reason: `Self-approval by PR author "${params.prAuthorLogin}" is not permitted by environment "${envName}".`,
  };
}
