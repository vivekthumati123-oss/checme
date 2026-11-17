import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "../config";
import {
  ARTIFACTS,
  EXIT_CODES,
  FinalSchema,
  ManifestSchema,
  ProposedSchema,
  SnapshotSchema,
  StageError,
  StageStatusSchema,
  ValidationReportSchema,
  type Final,
  type GitHubClientLike,
  type LoggerLike,
  type Manifest,
  type Snapshot,
  type StageStatus,
  type UnitAgentConfig,
  type ValidatedFileReport,
  type ValidationReport,
} from "../contracts";
import { sha256Hex } from "../core/context";
import { toRepoPath } from "../core/paths";
import { runStaticPolicyCheck } from "../core/policy";
import { deriveFinalContent } from "../core/prune";
import {
  DEFAULT_APPROVAL_ENVIRONMENT,
  buildCommentMarker,
  buildUnifiedNewFilePatch,
  inferLanguageForTestPath,
  truncateCommentMarkdown,
  upsertUnitAgentComment,
  verifyApprovalEnvironment,
} from "../github";
import { loadPromptTemplate } from "../llm";
import { loadOptionalResolvedConfig } from "./detect";
import {
  createInitialMetrics,
  incrementReasonCount,
  sanitizeForMarkdown,
  writeGitHubOutput,
  writeStageStatus,
  writeStepSummary,
} from "../telemetry";

export interface RunPublishOptions {
  repoRoot: string;
  workDir: string;
  configPath?: string;
  config?: UnitAgentConfig;
  reportPath?: string;
  report?: ValidationReport;
  finalPath?: string;
  finalArtifact?: Final;
  jobResults?: Record<string, string>;
  approvalEnvironment?: string;
  approvalCheck?: "api" | "manual";
  repoFullName?: string;
  prNumber?: number;
  headSha?: string;
  github?: GitHubClientLike;
  dryRun?: boolean;
  logger?: LoggerLike;
  writeOutputs?: boolean;
}

export const APPROVE_ENV_NAME = DEFAULT_APPROVAL_ENVIRONMENT;

export function parseJobResultsEnv(rawJson?: string): Record<string, string> {
  if (!rawJson || !rawJson.trim()) return {};
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") {
        out[k] = v;
      } else if (
        v &&
        typeof v === "object" &&
        "result" in v &&
        typeof (v as { result?: unknown }).result === "string"
      ) {
        out[k] = (v as { result: string }).result;
      }
    }
    return out;
  } catch {
    return { _parse_error: "failure" };
  }
}

function readUpstreamStatuses(workDir: string): StageStatus[] {
  const dirs = [
    ARTIFACTS.prepare.dir,
    ARTIFACTS.proposed.dir,
    ARTIFACTS.validate1.dir,
    ARTIFACTS.repaired.dir,
    ARTIFACTS.validate2.dir,
  ];
  const statuses: StageStatus[] = [];
  for (const dir of dirs) {
    const statusPath = path.join(workDir, dir, "status.json");
    if (!existsSync(statusPath)) continue;
    try {
      statuses.push(StageStatusSchema.parse(JSON.parse(readFileSync(statusPath, "utf8"))));
    } catch {
      // ignore malformed status.json
    }
  }
  return statuses;
}

function tryReadJsonFile<T>(filePath: string, parse: (raw: unknown) => T): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return parse(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

function validateRequiredInputs(
  workDir: string,
  jobResults: Record<string, string>,
  hasPrebuiltFinalOrReport: boolean,
): { ok: true } | { ok: false; missingArtifact: string; failingJob: string } {
  if (hasPrebuiltFinalOrReport) return { ok: true };

  const checks: Array<{ jobs: string[]; artifact: string; files: string[]; validate: (p: string) => boolean }> = [
    {
      jobs: ["generate"],
      artifact: ARTIFACTS.proposed.name,
      files: [path.join(workDir, ARTIFACTS.proposed.dir, "proposed.json")],
      validate: (p) => tryReadJsonFile(p, (raw) => ProposedSchema.parse(raw)) !== null,
    },
    {
      jobs: ["validate1", "validate_1"],
      artifact: ARTIFACTS.snapshot1.name,
      files: [path.join(workDir, ARTIFACTS.snapshot1.dir, "snapshot.json")],
      validate: (p) => tryReadJsonFile(p, (raw) => SnapshotSchema.parse(raw)) !== null,
    },
    {
      jobs: ["validate1", "validate_1"],
      artifact: ARTIFACTS.validate1.name,
      files: [path.join(workDir, ARTIFACTS.validate1.dir, "report.json")],
      validate: (p) => tryReadJsonFile(p, (raw) => ValidationReportSchema.parse(raw)) !== null,
    },
    {
      jobs: ["repair"],
      artifact: ARTIFACTS.repaired.name,
      files: [
        path.join(workDir, ARTIFACTS.repaired.dir, "proposed.repaired.json"),
        path.join(workDir, ARTIFACTS.repaired.dir, "repaired.json"),
      ],
      validate: (p) => tryReadJsonFile(p, (raw) => ProposedSchema.parse(raw)) !== null,
    },
    {
      jobs: ["validate2", "validate_2"],
      artifact: ARTIFACTS.snapshot2.name,
      files: [path.join(workDir, ARTIFACTS.snapshot2.dir, "snapshot.json")],
      validate: (p) => tryReadJsonFile(p, (raw) => SnapshotSchema.parse(raw)) !== null,
    },
    {
      jobs: ["validate2", "validate_2"],
      artifact: ARTIFACTS.validate2.name,
      files: [path.join(workDir, ARTIFACTS.validate2.dir, "report.json")],
      validate: (p) => tryReadJsonFile(p, (raw) => ValidationReportSchema.parse(raw)) !== null,
    },
  ];

  for (const check of checks) {
    const matchedJob = check.jobs.find((j) => jobResults[j] === "success");
    if (!matchedJob) continue;
    const validFile = check.files.find((f) => check.validate(f));
    if (!validFile) {
      return { ok: false, missingArtifact: check.artifact, failingJob: matchedJob };
    }
  }
  return { ok: true };
}

function readSnapshotContent(params: {
  workDir: string;
  attempt: 1 | 2;
  testPath: string;
  snapshot: Snapshot | null;
}): { ok: boolean; content: string; reason?: string } {
  const snapDir = params.attempt === 1 ? ARTIFACTS.snapshot1.dir : ARTIFACTS.snapshot2.dir;
  const snapFile = path.join(params.workDir, snapDir, "validated", params.testPath);
  const finalFallbackFile = path.join(params.workDir, ARTIFACTS.final.dir, "validated", params.testPath);
  const targetPath = existsSync(snapFile) ? snapFile : finalFallbackFile;
  if (!existsSync(targetPath)) {
    return { ok: false, content: "", reason: "snapshot_missing" };
  }
  const content = readFileSync(targetPath, "utf8");
  if (params.snapshot) {
    const norm = toRepoPathSafe(params.testPath);
    const entry = params.snapshot.files.find((e) => toRepoPathSafe(e.testPath) === norm);
    if (entry && existsSync(snapFile)) {
      const actual = sha256Hex(content);
      if (actual !== entry.sha256) {
        return { ok: false, content: "", reason: "policy_violation" };
      }
    }
  }
  return { ok: true, content };
}

function toRepoPathSafe(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

async function assembleFinalFromSnapshots(params: {
  repoRoot: string;
  workDir: string;
  config: UnitAgentConfig;
  manifest: Manifest | null;
  report1: ValidationReport | null;
  report2: ValidationReport | null;
}): Promise<{ report: ValidationReport; finalArtifact: Final; notes: string[] }> {
  const notes: string[] = [];
  const snap1 = tryReadJsonFile(path.join(params.workDir, ARTIFACTS.snapshot1.dir, "snapshot.json"), (r) =>
    SnapshotSchema.parse(r),
  );
  const snap2 = tryReadJsonFile(path.join(params.workDir, ARTIFACTS.snapshot2.dir, "snapshot.json"), (r) =>
    SnapshotSchema.parse(r),
  );
  const mergedReportsByPath = new Map<string, { attempt: 1 | 2; fr: ValidatedFileReport }>();

  for (const fr of params.report1?.files ?? []) {
    mergedReportsByPath.set(fr.testPath, { attempt: 1, fr });
  }
  for (const fr of params.report2?.files ?? []) {
    mergedReportsByPath.set(fr.testPath, { attempt: 2, fr });
  }

  const finalDir = path.join(params.workDir, ARTIFACTS.final.dir);
  const finalFiles: Final["files"] = [];
  const rejected: Final["rejected"] = [];
  const manifestById = new Map((params.manifest?.files ?? []).map((m) => [m.fileId, m]));

  for (const { attempt, fr } of mergedReportsByPath.values()) {
    if (fr.outcome !== "accepted" && fr.outcome !== "accepted_pruned") {
      rejected.push({ testPath: fr.testPath, reason: fr.reason ?? fr.outcome });
      continue;
    }

    try {
      toRepoPath(fr.testPath, params.repoRoot);
    } catch {
      rejected.push({ testPath: fr.testPath, reason: "path_violation" });
      continue;
    }

    const snapRes = readSnapshotContent({
      workDir: params.workDir,
      attempt,
      testPath: fr.testPath,
      snapshot: attempt === 1 ? snap1 : snap2,
    });
    if (!snapRes.ok) {
      rejected.push({ testPath: fr.testPath, reason: snapRes.reason ?? "policy_violation" });
      continue;
    }

    let finalContent = snapRes.content;
    const mf = manifestById.get(fr.fileId);
    const lang = mf?.language ?? inferLanguageForTestPath(fr.testPath);

    if (fr.outcome === "accepted_pruned" && fr.prunedTests && fr.prunedTests.length > 0) {
      const derived = await deriveFinalContent({
        language: lang,
        testPath: fr.testPath,
        content: snapRes.content,
        failingTestNames: fr.prunedTests,
        repoRoot: params.repoRoot,
        configEol: params.config.files.eol,
        provenanceHeader: params.config.policy.provenanceHeader,
      });
      if (fr.finalSha256 && sha256Hex(derived.content) !== fr.finalSha256) {
        rejected.push({ testPath: fr.testPath, reason: "policy_violation" });
        continue;
      }
      finalContent = derived.content;
    }

    const policyRes = await runStaticPolicyCheck({
      language: lang,
      testPath: fr.testPath,
      content: finalContent,
      importHint: mf?.importHint,
      sourcePath: mf?.path,
      targetCount: Math.max(1, mf?.symbols.length ?? 1),
      maxTestsPerSymbol: params.config.limits.maxTestsPerSymbol,
      extraBannedImports: params.config.policy.extraBannedImports,
    });
    if (!policyRes.ok) {
      rejected.push({ testPath: fr.testPath, reason: "policy_violation" });
      continue;
    }

    const destPath = path.join(finalDir, "validated", fr.testPath);
    mkdirSync(path.dirname(destPath), { recursive: true });
    writeFileSync(destPath, finalContent, "utf8");

    const passingCount = fr.tests.filter((t) => t.status === "pass").length || policyRes.testCount;
    finalFiles.push({
      path: fr.testPath,
      sha256: sha256Hex(finalContent),
      symbolIds: (mf?.symbols ?? []).map((s) => s.symbolId),
      testCount: passingCount,
      assumptions: [],
    });
  }

  const latestReport = params.report2 ?? params.report1;
  if (!latestReport) {
    throw new StageError(
      "Validation report not found in validate1/ or validate2/.",
      EXIT_CODES.CONFIG_OR_INPUT,
      "publish",
      "missing_report",
    );
  }

  const mergedReport = ValidationReportSchema.parse({
    ...latestReport,
    files: [...mergedReportsByPath.values()].map((v) => v.fr),
    notes: [...latestReport.notes, ...notes],
  });

  const finalArtifact = FinalSchema.parse({
    schemaVersion: 1,
    runId: params.manifest?.runId || process.env.GITHUB_RUN_ID || "local-run",
    repo: params.manifest?.repo || process.env.GITHUB_REPOSITORY || "unknown/unknown",
    pr: params.manifest?.pr ?? 0,
    headSha: params.manifest?.headSha ?? snap1?.headSha ?? snap2?.headSha ?? "unknown",
    headRef: process.env.GITHUB_HEAD_REF || "HEAD",
    mode: params.config.mode,
    files: finalFiles,
    patchCoverage: {
      beforePct: mergedReport.patchCoverage.beforePct,
      projectedPct: mergedReport.patchCoverage.projectedPct,
      targetPct: params.config.targets.patchCoverage,
    },
    toolVersions: mergedReport.toolVersions,
    notes: mergedReport.notes,
    rejected,
  });

  return { report: mergedReport, finalArtifact, notes };
}

export function renderPublishSummaryMarkdown(params: {
  finalArtifact: Final;
  report: ValidationReport;
  failedUpstreamJobs: string[];
  upstreamStatuses?: StageStatus[];
  approvalEnvironment?: string;
  approvalWarning?: string;
  llmRequests?: number;
}): string {
  const { finalArtifact, report } = params;
  const marker = buildCommentMarker(finalArtifact.headSha);
  const template = loadPromptTemplate("comment.md");
  const envName = params.approvalEnvironment ?? APPROVE_ENV_NAME;

  const beforePct =
    finalArtifact.patchCoverage.beforePct !== null
      ? `${finalArtifact.patchCoverage.beforePct.toFixed(1)}%`
      : "n/a (no coverage)";
  const afterPct =
    finalArtifact.patchCoverage.projectedPct !== null
      ? `${finalArtifact.patchCoverage.projectedPct.toFixed(1)}%`
      : "n/a";
  const deltaNum =
    finalArtifact.patchCoverage.beforePct !== null && finalArtifact.patchCoverage.projectedPct !== null
      ? finalArtifact.patchCoverage.projectedPct - finalArtifact.patchCoverage.beforePct
      : null;
  const deltaStr = deltaNum !== null ? `${deltaNum >= 0 ? "+" : ""}${deltaNum.toFixed(1)} pp` : "n/a";

  const rows: string[] = [];
  for (const fr of report.files) {
    const kept = fr.tests.filter((t) => t.status === "pass").length;
    const total = fr.tests.length || kept;
    const notesParts: string[] = [];
    if (fr.reason) notesParts.push(fr.reason);
    if (fr.prunedTests && fr.prunedTests.length > 0) {
      notesParts.push(`pruned ${fr.prunedTests.length}`);
    }
    if (fr.coverage) {
      notesParts.push(`+${fr.coverage.gainedLines} lines`);
    }
    rows.push(
      `| \`${sanitizeForMarkdown(fr.testPath, 160)}\` | \`${fr.outcome}\` | ${kept} / ${total} | ${sanitizeForMarkdown(notesParts.join("; ") || "-", 200)} |`,
    );
  }

  let statusLabel = finalArtifact.files.length > 0 ? "ready" : "no_accepted_tests";
  if (params.failedUpstreamJobs.length > 0) {
    statusLabel = `incomplete (upstream failures: ${params.failedUpstreamJobs.join(", ")})`;
  } else if (report.environment) {
    statusLabel = `environment_error (${report.environment.reason})`;
  }

  const baselineStatus = finalArtifact.patchCoverage.beforePct !== null ? "green" : "no_coverage";

  let rendered = template
    .replace("{{marker}}", marker)
    .replace("{{mode}}", finalArtifact.mode)
    .replace("{{statusLabel}}", sanitizeForMarkdown(statusLabel, 200))
    .replace("{{baselineStatus}}", baselineStatus)
    .replace("{{baselinePatchPct}}", beforePct)
    .replace("{{afterPatchPct}}", afterPct)
    .replace("{{coverageDelta}}", deltaStr);

  if (rows.length > 0) {
    rendered = rendered.replace("{{#if rows}}", "").replace("{{/if}}", "").replace("{{rows}}", rows.join("\n"));
  } else {
    rendered = rendered.replace(/\{\{#if rows\}\}[\s\S]*?\{\{\/if\}\}/, "_No test files accepted._");
  }

  const bannerText = params.approvalWarning
    ? params.approvalWarning
    : finalArtifact.mode === "propose" && finalArtifact.files.length > 0
      ? `Review the validated test summary above, then approve the \`${sanitizeForMarkdown(envName, 80)}\` environment deployment to commit these tests.`
      : "";

  if (bannerText) {
    rendered = rendered
      .replace("{{#if approvalBanner}}", "")
      .replace("{{/if}}", "")
      .replace("{{approvalBanner}}", sanitizeForMarkdown(bannerText, 400));
  } else {
    rendered = rendered.replace(/\{\{#if approvalBanner\}\}[\s\S]*?\{\{\/if\}\}/, "");
  }

  const extras: string[] = [];
  if (params.failedUpstreamJobs.length > 0) {
    extras.push(
      `> [!WARNING]\n> **Incomplete Run**: Upstream job(s) did not succeed (${sanitizeForMarkdown(params.failedUpstreamJobs.join(", "), 200)}). Auto-commit will not proceed.`,
    );
  }
  for (const st of params.upstreamStatuses ?? []) {
    if (st.status !== "ok" && st.reason) {
      extras.push(`- **${st.stage}** (\`${st.status}\`): ${sanitizeForMarkdown(st.reason, 240)}`);
    }
  }
  if (report.environment) {
    extras.push(
      `> [!CAUTION]\n> Environment failure during \`${sanitizeForMarkdown(report.environment.command, 160)}\` (\`${report.environment.reason}\`): ${sanitizeForMarkdown(report.environment.outputTail, 400)}`,
    );
  }
  if (finalArtifact.rejected.length > 0) {
    const rejLines = finalArtifact.rejected
      .slice(0, 10)
      .map((r) => `- \`${sanitizeForMarkdown(r.testPath, 160)}\`: ${sanitizeForMarkdown(r.reason, 200)}`);
    extras.push("**Rejected Files**", ...rejLines);
  }
  const extraNotes = finalArtifact.notes.filter((n) => n && n !== params.approvalWarning);
  if (extraNotes.length > 0) {
    const noteLines = extraNotes.slice(0, 5).map((n) => `- ${sanitizeForMarkdown(n, 240)}`);
    extras.push("**Warnings / Notes**", ...noteLines);
  }

  const toolParts: string[] = [`Agent Node ${sanitizeForMarkdown(finalArtifact.toolVersions.agentNode, 40)}`];
  for (const [lang, info] of Object.entries(finalArtifact.toolVersions.languages)) {
    const rt = info.runtime?.version ?? info.runtime?.source ?? "unknown";
    const bt = info.buildTool?.version ? `/${info.buildTool.version}` : "";
    const fw = info.framework
      ? info.framework.version
        ? `${info.framework.name}@${info.framework.version}`
        : info.framework.name
      : "unknown";
    toolParts.push(`${sanitizeForMarkdown(lang, 20)}: ${sanitizeForMarkdown(`${rt}${bt}, ${fw} (${info.tier})`, 80)}`);
  }
  const reqPart = typeof params.llmRequests === "number" ? ` | LLM requests: ${params.llmRequests}` : "";
  extras.push(`_Tooling: ${toolParts.join("; ")}${reqPart}_`);

  const fullMarkdown = extras.length > 0 ? `${rendered.trim()}\n\n${extras.join("\n")}\n` : `${rendered.trim()}\n`;
  return truncateCommentMarkdown(fullMarkdown);
}

export async function runPublish(opts: RunPublishOptions): Promise<{
  finalArtifact: Final;
  markdown: string;
  commentId?: number;
}> {
  const v2Path = path.join(opts.workDir, ARTIFACTS.validate2.dir, "report.json");
  const v1Path = path.join(opts.workDir, ARTIFACTS.validate1.dir, "report.json");
  const finalFile = opts.finalPath ?? path.join(opts.workDir, ARTIFACTS.final.dir, "final.json");
  const prepareNoticePath = path.join(opts.workDir, ARTIFACTS.prepare.dir, "notice.md");
  const hasValidationOutputs =
    Boolean(opts.report) ||
    Boolean(opts.finalArtifact) ||
    Boolean(opts.reportPath && existsSync(opts.reportPath)) ||
    existsSync(v2Path) ||
    existsSync(v1Path) ||
    existsSync(finalFile);

  let config =
    opts.config ??
    loadOptionalResolvedConfig({
      repoRoot: opts.repoRoot,
      configPath: opts.configPath,
      fallbackDirs: [path.join(opts.workDir, ARTIFACTS.prepare.dir), path.join(opts.workDir, ARTIFACTS.final.dir)],
    });
  const isNoticeOnly = !hasValidationOutputs && existsSync(prepareNoticePath);
  if (!config && !isNoticeOnly) {
    config = loadConfig(opts.repoRoot, opts.configPath).config;
  }
  const targetPct = config?.targets.patchCoverage ?? 80;
  const envName = opts.approvalEnvironment ?? process.env.UA_APPROVAL_ENV ?? APPROVE_ENV_NAME;
  const checkMode = (opts.approvalCheck ?? process.env.UA_APPROVAL_CHECK ?? "api") as "api" | "manual";

  const jobResults = opts.jobResults ?? parseJobResultsEnv(process.env.UA_JOB_RESULTS);
  const failedUpstreamJobs = Object.entries(jobResults)
    .filter(([, result]) => result !== "success" && result !== "skipped")
    .map(([name, result]) => `${name}=${result}`);

  const upstreamStatuses = readUpstreamStatuses(opts.workDir);
  const manifest = tryReadJsonFile(path.join(opts.workDir, ARTIFACTS.prepare.dir, "manifest.json"), (r) =>
    ManifestSchema.parse(r),
  );

  // Notice-only branch when prepare produced notice without validation outputs

  const reqCheck = validateRequiredInputs(opts.workDir, jobResults, Boolean(opts.report && opts.finalArtifact));
  if (!reqCheck.ok) {
    const repoStr = opts.repoFullName || manifest?.repo || process.env.GITHUB_REPOSITORY || "unknown/unknown";
    const prNum = opts.prNumber ?? manifest?.pr ?? 0;
    const headSha = opts.headSha ?? manifest?.headSha ?? "unknown";
    const failMsg = `\`${reqCheck.missingArtifact}\` was expected from \`${reqCheck.failingJob}\` but was missing or invalid; check the \`${reqCheck.failingJob}\` job logs.`;
    const markdown = truncateCommentMarkdown(
      `${buildCommentMarker(headSha)}\n## unit-agent: incomplete run\n\n> [!WARNING]\n> ${failMsg}\n`,
    );
    writeStepSummary(markdown);

    let commentId: number | undefined;
    if (opts.github && !opts.dryRun && prNum > 0) {
      const [owner = "", repo = ""] = repoStr.split("/");
      if (owner && repo) {
        commentId = await upsertUnitAgentComment({ github: opts.github, owner, repo, pr: prNum, body: markdown });
      }
    }

    const softReason = `missing_required_input:${reqCheck.missingArtifact}`;
    const emptyFinal = FinalSchema.parse({
      schemaVersion: 1,
      runId: manifest?.runId || process.env.GITHUB_RUN_ID || "unknown",
      repo: repoStr,
      pr: prNum,
      headSha,
      headRef: process.env.GITHUB_HEAD_REF || "HEAD",
      mode: "report",
      files: [],
      patchCoverage: { beforePct: null, projectedPct: null, targetPct },
      toolVersions: { agentNode: process.versions.node, languages: {}, warnings: [failMsg] },
      notes: [failMsg],
      rejected: [],
    });
    mkdirSync(path.dirname(finalFile), { recursive: true });
    writeFileSync(finalFile, `${JSON.stringify(emptyFinal, null, 2)}\n`, "utf8");
    writeStageStatus(opts.workDir, { stage: "publish", status: "soft_fail", reason: softReason, code: 20 });
    if (opts.writeOutputs !== false) {
      writeGitHubOutput({
        effective_mode: "report",
        accepted_count: 0,
        has_tests: "false",
        ready_for_commit: "false",
        status: "soft_fail",
      });
    }
    return { finalArtifact: emptyFinal, markdown, commentId };
  }

  if (!hasValidationOutputs && existsSync(prepareNoticePath)) {
    const noticeText = readFileSync(prepareNoticePath, "utf8").trim();
    const repoStr = opts.repoFullName || manifest?.repo || process.env.GITHUB_REPOSITORY || "unknown/unknown";
    const prNum = opts.prNumber ?? manifest?.pr ?? 0;
    const headSha = opts.headSha ?? manifest?.headSha ?? "unknown";
    const markdown = truncateCommentMarkdown(`${buildCommentMarker(headSha)}\n${noticeText}\n`);
    writeStepSummary(markdown);
    let commentId: number | undefined;
    if (opts.github && !opts.dryRun && prNum > 0) {
      const [owner = "", repo = ""] = repoStr.split("/");
      if (owner && repo) {
        commentId = await upsertUnitAgentComment({ github: opts.github, owner, repo, pr: prNum, body: markdown });
      }
    }
    const noticeFinal = FinalSchema.parse({
      schemaVersion: 1,
      runId: manifest?.runId || process.env.GITHUB_RUN_ID || "unknown",
      repo: repoStr,
      pr: prNum,
      headSha,
      headRef: process.env.GITHUB_HEAD_REF || "HEAD",
      mode: "report",
      files: [],
      patchCoverage: { beforePct: null, projectedPct: null, targetPct },
      toolVersions: { agentNode: process.versions.node, languages: {}, warnings: [] },
      notes: [noticeText],
      rejected: [],
    });
    mkdirSync(path.dirname(finalFile), { recursive: true });
    writeFileSync(finalFile, `${JSON.stringify(noticeFinal, null, 2)}\n`, "utf8");
    writeStageStatus(opts.workDir, { stage: "publish", status: "ok", reason: "notice_posted" });
    if (opts.writeOutputs !== false) {
      writeGitHubOutput({
        effective_mode: "report",
        accepted_count: 0,
        has_tests: "false",
        ready_for_commit: "false",
        status: "ok",
      });
    }
    return { finalArtifact: noticeFinal, markdown, commentId };
  }

  const activeConfig = config ?? loadConfig(opts.repoRoot, opts.configPath).config;
  let report = opts.report;
  let finalArtifact = opts.finalArtifact;

  const r1 = tryReadJsonFile(v1Path, (r) => ValidationReportSchema.parse(r));
  const r2 = tryReadJsonFile(v2Path, (r) => ValidationReportSchema.parse(r));

  if (!finalArtifact && !existsSync(finalFile) && (r1 || r2)) {
    const assembled = await assembleFinalFromSnapshots({
      repoRoot: opts.repoRoot,
      workDir: opts.workDir,
      config: activeConfig,
      manifest,
      report1: r1,
      report2: r2,
    });
    report = report ?? assembled.report;
    finalArtifact = assembled.finalArtifact;
  }

  if (!report) {
    const chosen = opts.reportPath ?? (existsSync(v2Path) ? v2Path : v1Path);
    if (!existsSync(chosen)) {
      throw new StageError(
        `Validation report not found: "${chosen}".`,
        EXIT_CODES.CONFIG_OR_INPUT,
        "publish",
        "missing_report",
      );
    }
    report = ValidationReportSchema.parse(JSON.parse(readFileSync(chosen, "utf8")));
  }

  if (!finalArtifact) {
    if (!existsSync(finalFile)) {
      throw new StageError(
        `Final artifact not found: "${finalFile}".`,
        EXIT_CODES.CONFIG_OR_INPUT,
        "publish",
        "missing_final",
      );
    }
    finalArtifact = FinalSchema.parse(JSON.parse(readFileSync(finalFile, "utf8")));
  }

  // F3: Verify approval environment when mode === "propose"
  let effectiveMode = activeConfig.mode;
  let approvalWarning: string | undefined;

  if (effectiveMode === "propose" && finalArtifact.files.length > 0 && opts.github && !opts.dryRun) {
    const [owner = "", repo = ""] = finalArtifact.repo.split("/");
    if (owner && repo) {
      const envRes = await verifyApprovalEnvironment({
        github: opts.github,
        owner,
        repo,
        environmentName: envName,
        approvalCheck: checkMode,
      });
      if (envRes.downgradedToReport) {
        effectiveMode = "report";
        approvalWarning = envRes.warning;
        if (approvalWarning) {
          opts.logger?.warn({ envName }, approvalWarning);
        }
      }
    }
  }

  const planWarnings: string[] = [];
  const planObj = tryReadJsonFile(
    path.join(opts.workDir, ARTIFACTS.prepare.dir, "plan.json"),
    (r) => r as { warnings?: string[] },
  );
  if (planObj && Array.isArray(planObj.warnings)) {
    for (const w of planObj.warnings) {
      if (typeof w === "string" && w.trim()) planWarnings.push(w);
    }
  }
  const combinedNotes = [...finalArtifact.notes];
  for (const w of [...planWarnings, ...(approvalWarning ? [approvalWarning] : [])]) {
    if (!combinedNotes.includes(w)) combinedNotes.push(w);
  }

  const updatedFinal = FinalSchema.parse({
    ...finalArtifact,
    mode: effectiveMode,
    notes: combinedNotes,
  });

  mkdirSync(path.dirname(finalFile), { recursive: true });
  writeFileSync(finalFile, `${JSON.stringify(updatedFinal, null, 2)}\n`, "utf8");

  // Write final/resolved-config.json so checkout-less approve-and-commit can honor commit/policy config
  const finalDir = path.join(opts.workDir, ARTIFACTS.final.dir);
  writeFileSync(path.join(finalDir, "resolved-config.json"), `${JSON.stringify(activeConfig, null, 2)}\n`, "utf8");

  // Write final/patch.diff & final/metrics.json
  const patchEntries: Array<{ path: string; content: string }> = [];
  for (const f of updatedFinal.files) {
    const valFile = path.join(finalDir, "validated", f.path);
    if (!existsSync(valFile)) continue;
    patchEntries.push({ path: f.path, content: readFileSync(valFile, "utf8") });
  }
  writeFileSync(path.join(finalDir, "patch.diff"), buildUnifiedNewFilePatch(patchEntries), "utf8");

  let llmRequests = 0;
  for (const pPath of [
    path.join(opts.workDir, ARTIFACTS.proposed.dir, "proposed.json"),
    path.join(opts.workDir, ARTIFACTS.repaired.dir, "proposed.repaired.json"),
  ]) {
    const parsedProposed = tryReadJsonFile(pPath, (r) => ProposedSchema.parse(r));
    if (parsedProposed) {
      for (const f of parsedProposed.files) {
        llmRequests += f.usage?.requests ?? 0;
      }
    }
  }

  const metrics = createInitialMetrics({
    runId: updatedFinal.runId,
    repo: updatedFinal.repo,
    pr: updatedFinal.pr,
    sha: updatedFinal.headSha,
    mode: updatedFinal.mode,
    agentVersion: "2.0.0",
    toolVersions: updatedFinal.toolVersions,
  });
  metrics.llm.requests = llmRequests;
  for (const fr of report.files) {
    if (fr.outcome === "accepted") metrics.files.accepted += 1;
    else if (fr.outcome === "accepted_pruned") metrics.files.acceptedPruned += 1;
    else metrics.files.rejected += 1;
    if (fr.reason) incrementReasonCount(metrics, fr.reason);
  }
  metrics.coverage.patchBeforePct = updatedFinal.patchCoverage.beforePct;
  metrics.coverage.patchProjectedPct = updatedFinal.patchCoverage.projectedPct;
  metrics.outcome =
    updatedFinal.files.length === 0
      ? "no_work"
      : updatedFinal.mode === "propose"
        ? "awaiting_approval"
        : "report_posted";
  writeFileSync(path.join(finalDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`, "utf8");

  const markdown = renderPublishSummaryMarkdown({
    finalArtifact: updatedFinal,
    report,
    failedUpstreamJobs,
    upstreamStatuses,
    approvalEnvironment: envName,
    approvalWarning,
    llmRequests,
  });

  writeStepSummary(markdown);

  let commentId: number | undefined;
  if (opts.github && !opts.dryRun && updatedFinal.pr > 0) {
    const [owner = "", repo = ""] = updatedFinal.repo.split("/");
    if (owner && repo) {
      commentId = await upsertUnitAgentComment({
        github: opts.github,
        owner,
        repo,
        pr: updatedFinal.pr,
        body: markdown,
      });
    }
  }

  const hasTests = updatedFinal.mode === "propose" && updatedFinal.files.length > 0 && failedUpstreamJobs.length === 0;

  writeStageStatus(opts.workDir, {
    stage: "publish",
    status: failedUpstreamJobs.length > 0 ? "soft_fail" : "ok",
    reason: updatedFinal.files.length > 0 ? "published" : "no_accepted_files",
  });

  if (opts.writeOutputs !== false) {
    writeGitHubOutput({
      effective_mode: effectiveMode,
      accepted_count: updatedFinal.files.length,
      has_tests: String(hasTests),
      ready_for_commit: String(hasTests),
      status: failedUpstreamJobs.length > 0 ? "soft_fail" : "ok",
    });
  }

  return { finalArtifact: updatedFinal, markdown, commentId };
}
