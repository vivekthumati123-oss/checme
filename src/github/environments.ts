import type { GitHubClientLike } from "../contracts";

export const DEFAULT_APPROVAL_ENVIRONMENT = "unit-agent-approval";

export interface EnvironmentCheckResult {
  ok: boolean;
  downgradedToReport: boolean;
  warning?: string;
}

export async function verifyApprovalEnvironment(params: {
  github: GitHubClientLike;
  owner: string;
  repo: string;
  environmentName: string;
  approvalCheck: "api" | "manual";
}): Promise<EnvironmentCheckResult> {
  if (params.approvalCheck === "manual") {
    return { ok: true, downgradedToReport: false };
  }

  const envInfo = await params.github.getEnvironment(params.owner, params.repo, params.environmentName);
  if (envInfo.status === 403) {
    return {
      ok: false,
      downgradedToReport: true,
      warning: `Cannot verify approval environment "${params.environmentName}" (403); confirm reviewers and set \`approval-check: manual\` (docs/setup.md).`,
    };
  }
  if (!envInfo.exists || !envInfo.hasRequiredReviewers) {
    return {
      ok: false,
      downgradedToReport: true,
      warning: `Environment "${params.environmentName}" is missing or has no required reviewers configured. Downgraded to report-only mode (F3).`,
    };
  }
  return { ok: true, downgradedToReport: false };
}
