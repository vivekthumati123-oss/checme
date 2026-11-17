import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  ManifestSchema,
  PlanOutputSchema,
  StageStatusSchema,
  type GitHubClientLike,
  type StageStatus,
} from "../contracts";
import { sanitizeForMarkdown, sanitizeOutput, writeStepSummary } from "../telemetry";

const GUARD_SKIP_REASONS = new Set<string>([
  "disabled",
  "not_pull_request",
  "fork_pr",
  "draft_pr",
  "skip_label",
  "bot_pr",
  "skip_commit_message",
  "commit_loop",
]);

const GUARD_SKIP_DESCRIPTIONS: Record<string, string> = {
  disabled: "Unit Agent is disabled by configuration (`enabled: false`).",
  not_pull_request: "Triggered event is not a pull request.",
  fork_pr: "Pull request originates from a fork repository; skipping execution and PR commenting for security.",
  draft_pr: "Pull request is a draft (`skipDrafts: true`).",
  skip_label: "Pull request carries a configured skip label.",
  bot_pr: "Pull request author is in the ignored bots list.",
  skip_commit_message: "Latest commit message contains `[skip unit-agent]`.",
  commit_loop: "Latest commit was authored by Unit Agent; skipping to avoid a commit loop.",
};

const MAX_LIST_ITEMS = 15;
const MAX_WARNINGS = 10;

export interface NoticePlanSummary {
  skipped: Array<{ language: string; reason: string; found?: string }>;
  warnings?: string[];
}

export interface NoticeManifestSummary {
  skipped: Array<{ path: string; reason: string; detail?: string }>;
  warnings?: string[];
}

export interface NoticeBaselineSummary {
  status?: string;
  exitCode?: number;
  command?: string;
  summary?: string;
  mismatchReason?: string;
}

export interface RunNoticeOptions {
  workDir: string;
  repoRoot: string;
  repoFullName?: string;
  prNumber?: number;
  reason?: string;
  skipReason?: string;
  github?: GitHubClientLike;
  dryRun?: boolean;
}

/** Sanitize text for inline Markdown code spans while preserving underscores and @version tags. */
function sanitizeCodeSpan(text: string, maxChars = 200, repoRoot?: string): string {
  let clean = sanitizeOutput(text, repoRoot ? { repoRoot } : undefined);
  clean = clean
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  clean = clean
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(^|[\s(])@([a-zA-Z0-9_-])/g, "$1@\u200B$2")
    .replace(/(^|[\s(])#(\d+)/g, "$1#\u200B$2")
    .replace(/`/g, "'");
  if (clean.length > maxChars) {
    clean = `${clean.slice(0, Math.max(0, maxChars - 3))}...`;
  }
  return clean;
}

function tryReadJson(filePath: string): unknown {
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function readStatuses(workDir: string): StageStatus[] {
  const statuses: StageStatus[] = [];
  for (const dir of ["prepare", "generate", "validate1", "repair", "validate2", "final"]) {
    const raw = tryReadJson(path.join(workDir, dir, "status.json"));
    if (!raw || typeof raw !== "object") continue;
    const parsed = StageStatusSchema.safeParse(raw);
    if (parsed.success) {
      statuses.push(parsed.data);
      continue;
    }
    const obj = raw as Record<string, unknown>;
    if (
      (obj.stage === "prepare" ||
        obj.stage === "generate" ||
        obj.stage === "validate1" ||
        obj.stage === "repair" ||
        obj.stage === "validate2" ||
        obj.stage === "publish" ||
        obj.stage === "commit") &&
      (obj.status === "ok" || obj.status === "skipped" || obj.status === "soft_fail" || obj.status === "error")
    ) {
      statuses.push({
        stage: obj.stage,
        status: obj.status,
        reason: typeof obj.reason === "string" ? obj.reason : undefined,
      });
    }
  }
  return statuses;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function readOptionalArtifacts(workDir: string): {
  plan?: NoticePlanSummary;
  manifest?: NoticeManifestSummary;
  baseline?: NoticeBaselineSummary;
} {
  const rawPlan = tryReadJson(path.join(workDir, "prepare", "plan.json"));
  const planParsed = rawPlan ? PlanOutputSchema.safeParse(rawPlan) : undefined;
  let plan: NoticePlanSummary | undefined = planParsed?.success ? planParsed.data : undefined;
  if (!plan && rawPlan && typeof rawPlan === "object") {
    const obj = rawPlan as Record<string, unknown>;
    const skipped = Array.isArray(obj.skipped)
      ? obj.skipped
          .filter(
            (x): x is { language: string; reason: string; found?: string } =>
              Boolean(x) &&
              typeof x === "object" &&
              typeof (x as Record<string, unknown>).language === "string" &&
              typeof (x as Record<string, unknown>).reason === "string",
          )
          .map((x) => ({
            language: x.language,
            reason: x.reason,
            found: typeof x.found === "string" ? x.found : undefined,
          }))
      : [];
    const warnings = readStringArray(obj.warnings);
    if (skipped.length > 0 || warnings.length > 0) {
      plan = { skipped, warnings };
    }
  }

  const rawManifest = tryReadJson(path.join(workDir, "prepare", "manifest.json"));
  const manifestParsed = rawManifest ? ManifestSchema.safeParse(rawManifest) : undefined;
  let manifest: NoticeManifestSummary | undefined = manifestParsed?.success ? manifestParsed.data : undefined;
  if (!manifest && rawManifest && typeof rawManifest === "object") {
    const obj = rawManifest as Record<string, unknown>;
    const skipped = Array.isArray(obj.skipped)
      ? obj.skipped
          .filter(
            (x): x is { path: string; reason: string; detail?: string } =>
              Boolean(x) &&
              typeof x === "object" &&
              typeof (x as Record<string, unknown>).path === "string" &&
              typeof (x as Record<string, unknown>).reason === "string",
          )
          .map((x) => ({
            path: x.path,
            reason: x.reason,
            detail: typeof x.detail === "string" ? x.detail : undefined,
          }))
      : [];
    const warnings = readStringArray(obj.warnings);
    if (skipped.length > 0 || warnings.length > 0) {
      manifest = { skipped, warnings };
    }
  }

  const rawBaseline = tryReadJson(path.join(workDir, "prepare", "baseline.json"));
  let baseline: NoticeBaselineSummary | undefined;
  if (rawBaseline && typeof rawBaseline === "object") {
    const b = rawBaseline as Record<string, unknown>;
    let mismatchReason: string | undefined;
    let firstLangDetail: string | undefined;
    if (b.perLanguage && typeof b.perLanguage === "object") {
      for (const val of Object.values(b.perLanguage as Record<string, unknown>)) {
        if (!val || typeof val !== "object") continue;
        const entry = val as Record<string, unknown>;
        if (!mismatchReason && typeof entry.mismatchReason === "string" && entry.mismatchReason) {
          mismatchReason = entry.mismatchReason;
        }
        if (!firstLangDetail && entry.status === "red" && typeof entry.detail === "string" && entry.detail) {
          firstLangDetail = entry.detail;
        }
      }
    }
    baseline = {
      status: typeof b.status === "string" ? b.status : undefined,
      exitCode: typeof b.exitCode === "number" ? b.exitCode : undefined,
      command: typeof b.command === "string" ? b.command : undefined,
      summary: typeof b.summary === "string" ? b.summary : firstLangDetail,
      mismatchReason,
    };
  }

  return { plan, manifest, baseline };
}

function formatStageReason(reason: string, repoRoot?: string): string {
  if (/^[a-z0-9_.-]+$/i.test(reason)) {
    return `\`${sanitizeCodeSpan(reason, 300, repoRoot)}\``;
  }
  return sanitizeForMarkdown(reason, 300, repoRoot ? { repoRoot } : undefined);
}

function formatSkippedLanguage(item: NoticePlanSummary["skipped"][number], repoRoot?: string): string {
  const lang = sanitizeCodeSpan(item.language, 40, repoRoot);
  const reason = sanitizeCodeSpan(item.reason, 80, repoRoot);
  if (item.reason === "unsupported_framework" && item.found) {
    const found = sanitizeCodeSpan(item.found, 120, repoRoot);
    if (/junit[-_.\s]?4\b/i.test(item.found)) {
      return `- **${lang}**: JUnit 4 found (\`${found}\`, \`${reason}\`) — only JUnit 5 is supported`;
    }
    return `- **${lang}**: \`${reason}\` (found \`${found}\`)`;
  }
  if (item.found) {
    return `- **${lang}**: \`${reason}\` (found \`${sanitizeCodeSpan(item.found, 120, repoRoot)}\`)`;
  }
  return `- **${lang}**: \`${reason}\``;
}

export function buildNoticeMarkdown(params: {
  prNumber: number;
  reason: string;
  statuses: StageStatus[];
  repoRoot?: string;
  plan?: NoticePlanSummary;
  manifest?: NoticeManifestSummary;
  baseline?: NoticeBaselineSummary;
}): string {
  const marker = `<!-- unit-agent:summary v1 pr=${params.prNumber} -->`;
  const cleanReason = sanitizeCodeSpan(params.reason, 200, params.repoRoot);
  const lines = [marker, "### Unit Agent — Notice", "", `- **Outcome:** skipped / soft-failed (\`${cleanReason}\`)`];

  const guardDescription = GUARD_SKIP_DESCRIPTIONS[params.reason];
  if (guardDescription) {
    lines.push(`- **Details:** ${guardDescription}`);
  }

  for (const st of params.statuses) {
    if (st.reason) {
      lines.push(`- **${st.stage}** (${st.status}): ${formatStageReason(st.reason, params.repoRoot)}`);
    }
  }

  if (params.baseline?.status === "red") {
    const cmdPart = params.baseline.command
      ? ` via \`${sanitizeCodeSpan(params.baseline.command, 160, params.repoRoot)}\``
      : "";
    const exitPart = typeof params.baseline.exitCode === "number" ? ` (exit code ${params.baseline.exitCode})` : "";
    lines.push(`- **Baseline:** red${cmdPart}${exitPart}`);
    if (params.baseline.summary) {
      lines.push(
        `  - ${sanitizeForMarkdown(params.baseline.summary, 300, params.repoRoot ? { repoRoot: params.repoRoot } : undefined)}`,
      );
    }
  }

  if (params.plan && params.plan.skipped.length > 0) {
    lines.push("");
    lines.push("#### Skipped Languages");
    for (const item of params.plan.skipped.slice(0, MAX_LIST_ITEMS)) {
      lines.push(formatSkippedLanguage(item, params.repoRoot));
    }
    if (params.plan.skipped.length > MAX_LIST_ITEMS) {
      lines.push(`- ...and ${params.plan.skipped.length - MAX_LIST_ITEMS} more`);
    }
  }

  if (params.manifest && params.manifest.skipped.length > 0) {
    lines.push("");
    lines.push("#### Skipped Files");
    for (const item of params.manifest.skipped.slice(0, MAX_LIST_ITEMS)) {
      const p = sanitizeCodeSpan(item.path, 200, params.repoRoot);
      const r = sanitizeCodeSpan(item.reason, 80, params.repoRoot);
      const detail = item.detail
        ? ` — ${sanitizeForMarkdown(item.detail, 200, params.repoRoot ? { repoRoot: params.repoRoot } : undefined)}`
        : "";
      lines.push(`- \`${p}\`: \`${r}\`${detail}`);
    }
    if (params.manifest.skipped.length > MAX_LIST_ITEMS) {
      lines.push(`- ...and ${params.manifest.skipped.length - MAX_LIST_ITEMS} more`);
    }
  }

  const warnings = Array.from(new Set([...(params.plan?.warnings ?? []), ...(params.manifest?.warnings ?? [])])).filter(
    (w) => w.trim().length > 0,
  );
  if (warnings.length > 0) {
    lines.push("");
    lines.push("#### Warnings");
    for (const w of warnings.slice(0, MAX_WARNINGS)) {
      lines.push(`- ${sanitizeForMarkdown(w, 300, params.repoRoot ? { repoRoot: params.repoRoot } : undefined)}`);
    }
    if (warnings.length > MAX_WARNINGS) {
      lines.push(`- ...and ${warnings.length - MAX_WARNINGS} more`);
    }
  }

  lines.push("");
  lines.push("No files were committed to your branch.");
  return lines.join("\n");
}

function resolveNoticeReason(params: {
  explicitReason?: string;
  skipReason?: string;
  statuses: StageStatus[];
  plan?: NoticePlanSummary;
  manifest?: NoticeManifestSummary;
  baseline?: NoticeBaselineSummary;
}): string {
  if (params.explicitReason?.trim()) return params.explicitReason.trim();
  if (params.skipReason?.trim()) return params.skipReason.trim();

  const primaryStatusReason = params.statuses.find(
    (s) => s.status !== "ok" && !(s.stage === "prepare" && s.reason === "no_targets") && Boolean(s.reason),
  )?.reason;
  if (primaryStatusReason) return primaryStatusReason;

  const firstPlanSkipped = params.plan?.skipped[0];
  if (firstPlanSkipped) {
    return firstPlanSkipped.reason;
  }
  if (params.baseline?.status === "red") {
    return params.baseline.mismatchReason ?? "baseline_red";
  }
  const firstManifestSkipped = params.manifest?.skipped[0];
  if (firstManifestSkipped) {
    return firstManifestSkipped.reason;
  }

  return params.statuses.find((s) => s.status !== "ok")?.reason ?? "skipped";
}

export async function runNotice(opts: RunNoticeOptions): Promise<string> {
  const statuses = readStatuses(opts.workDir);
  const { plan, manifest, baseline } = readOptionalArtifacts(opts.workDir);

  const reason = resolveNoticeReason({
    explicitReason: opts.reason,
    skipReason: opts.skipReason,
    statuses,
    plan,
    manifest,
    baseline,
  });
  const prNum = opts.prNumber ?? 0;
  const markdown = buildNoticeMarkdown({
    prNumber: prNum,
    reason,
    statuses,
    repoRoot: opts.repoRoot,
    plan,
    manifest,
    baseline,
  });

  writeStepSummary(markdown);

  const shouldPostPrComment =
    Boolean(opts.github) && !opts.dryRun && Boolean(opts.repoFullName) && prNum > 0 && !GUARD_SKIP_REASONS.has(reason);

  if (shouldPostPrComment && opts.github && opts.repoFullName) {
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
