import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import type { GitHubClientLike, StageStatus } from "../contracts";
import { sanitizeForMarkdown, writeStepSummary } from "../telemetry";

export interface RunNoticeOptions {
  workDir: string;
  repoRoot: string;
  repoFullName?: string;
  prNumber?: number;
  reason?: string;
  github?: GitHubClientLike;
  dryRun?: boolean;
}

export function buildNoticeMarkdown(params: { prNumber: number; reason: string; statuses: StageStatus[] }): string {
  const marker = `<!-- unit-agent:summary v1 pr=${params.prNumber} -->`;
  const lines = [
    marker,
    "### Unit Agent — Notice",
    "",
    `- **Outcome:** skipped / soft-failed (\`${sanitizeForMarkdown(params.reason, 200)}\`)`,
  ];

  for (const st of params.statuses) {
    if (st.reason) {
      lines.push(`- **${st.stage}** (${st.status}): ${sanitizeForMarkdown(st.reason, 300)}`);
    }
  }

  lines.push("");
  lines.push("No files were committed to your branch.");
  return lines.join("\n");
}

export async function runNotice(opts: RunNoticeOptions): Promise<string> {
  const statuses: StageStatus[] = [];
  for (const dir of ["prepare", "generate", "validate1", "repair", "validate2", "final"]) {
    const p = path.join(opts.workDir, dir, "status.json");
    if (!existsSync(p)) continue;
    try {
      statuses.push(JSON.parse(readFileSync(p, "utf8")) as StageStatus);
    } catch {
      // ignore malformed status
    }
  }

  const reason = opts.reason ?? statuses.find((s) => s.status !== "ok")?.reason ?? "skipped";
  const prNum = opts.prNumber ?? 0;
  const markdown = buildNoticeMarkdown({ prNumber: prNum, reason, statuses });

  writeStepSummary(markdown);

  if (opts.github && !opts.dryRun && opts.repoFullName && prNum > 0) {
    const [owner = "", repo = ""] = opts.repoFullName.split("/");
    if (owner && repo) {
      const marker = `<!-- unit-agent:summary v1 pr=${prNum} -->`;
      const existing = await opts.github.listIssueComments(owner, repo, prNum);
      const found = existing.find((c) => c.body.includes(marker));
      if (found) {
        await opts.github.updateIssueComment(owner, repo, found.id, markdown);
      } else {
        await opts.github.createIssueComment(owner, repo, prNum, markdown);
      }
    }
  }

  return markdown;
}
