import type { GitHubClientLike } from "../contracts";

export const UNIT_AGENT_COMMENT_PREFIX = "<!-- unit-agent:v1";
export const MAX_COMMENT_LENGTH = 60_000;

export function buildCommentMarker(headSha: string): string {
  return `<!-- unit-agent:v1 sha=${headSha} -->`;
}

export function truncateCommentMarkdown(markdown: string, maxChars = MAX_COMMENT_LENGTH): string {
  if (markdown.length <= maxChars) return markdown;
  const suffix =
    "\n\n...\n\n_Comment truncated to fit GitHub limit. Download the full report from the `ua-final` Actions artifact._\n";
  const budget = Math.max(0, maxChars - suffix.length);
  return `${markdown.slice(0, budget).trimEnd()}${suffix}`;
}

export async function upsertUnitAgentComment(params: {
  github: GitHubClientLike;
  owner: string;
  repo: string;
  pr: number;
  body: string;
}): Promise<number> {
  const safeBody = truncateCommentMarkdown(params.body);
  const existing = await params.github.listIssueComments(params.owner, params.repo, params.pr);
  const hit = existing.find((c) => c.body.includes(UNIT_AGENT_COMMENT_PREFIX));
  if (hit) {
    await params.github.updateIssueComment(params.owner, params.repo, hit.id, safeBody);
    return hit.id;
  }
  const created = await params.github.createIssueComment(params.owner, params.repo, params.pr, safeBody);
  return created.id;
}
