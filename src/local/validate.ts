import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "../config";
import {
  ARTIFACTS,
  EXIT_CODES,
  LocalValidateSummarySchema,
  ManifestSchema,
  ProposedSchema,
  StageError,
  type LocalValidateSummary,
  type ProposedFile,
  type UnitAgentConfig,
  type ValidatedFileReport,
} from "../contracts";
import { sha256Hex } from "../core/context";
import { cleanRepoRelative, normalizeSlashes } from "../core/paths";
import { runValidate } from "../stages/validate";
import { cleanupLeftoverPlacedFiles } from "./placement";

export interface RunLocalValidateOptions {
  repoRoot: string;
  workDir: string;
  configPath?: string;
  config?: UnitAgentConfig;
  attempt?: number;
  phase?: "static" | "run" | "all";
  wasmDir?: string;
}

function walkStagedFiles(dirAbs: string, stagingAbs: string): string[] {
  if (!existsSync(dirAbs)) return [];
  const results: string[] = [];
  for (const ent of readdirSync(dirAbs, { withFileTypes: true })) {
    if (ent.name === ".git" || ent.name === "node_modules") continue;
    const full = path.join(dirAbs, ent.name);
    if (ent.isDirectory()) {
      results.push(...walkStagedFiles(full, stagingAbs));
    } else if (ent.isFile()) {
      results.push(cleanRepoRelative(normalizeSlashes(path.relative(stagingAbs, full))));
    }
  }
  return results.sort();
}

function nextLocalAttemptNumber(workDir: string): number {
  if (!existsSync(workDir)) return 1;
  let maxN = 0;
  for (const ent of readdirSync(workDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const match = /^validate(\d+)$/.exec(ent.name);
    if (match) {
      const n = Number.parseInt(match[1] ?? "0", 10);
      if (n > maxN) maxN = n;
    }
  }
  return maxN + 1;
}

export async function runLocalValidate(opts: RunLocalValidateOptions): Promise<LocalValidateSummary> {
  cleanupLeftoverPlacedFiles(opts.workDir, opts.repoRoot);

  const config = opts.config ?? loadConfig(opts.repoRoot, opts.configPath).config;
  const manifestPath = path.join(opts.workDir, ARTIFACTS.prepare.dir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new StageError(
      `Manifest not found at "${manifestPath}". Run \`local detect\` first.`,
      EXIT_CODES.CONFIG_OR_INPUT,
      "local",
      "missing_manifest",
    );
  }
  const manifest = ManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));

  const stagingAbs = path.resolve(opts.repoRoot, config.local.stagingDir);
  const stagedFiles = walkStagedFiles(stagingAbs, stagingAbs);

  const manifestByTestPath = new Map(
    manifest.files.map((mf) => [cleanRepoRelative(normalizeSlashes(mf.testPath)), mf]),
  );

  const proposedFiles: ProposedFile[] = [];
  const unmatchedReports: ValidatedFileReport[] = [];
  const missingReports: ValidatedFileReport[] = [];

  for (const rel of stagedFiles) {
    const mf = manifestByTestPath.get(rel);
    if (!mf) {
      unmatchedReports.push({
        fileId: "unmatched",
        testPath: rel,
        outcome: "rejected",
        reason: "path_violation",
        gates: [{ gate: "path", status: "fail", detail: `Staged file "${rel}" is not in manifest.` }],
        tests: [],
        sha256: null,
      });
      continue;
    }

    const content = readFileSync(path.join(stagingAbs, rel), "utf8");
    proposedFiles.push({
      fileId: mf.fileId,
      testPath: cleanRepoRelative(normalizeSlashes(mf.testPath)),
      content,
      sha256: sha256Hex(content),
      symbolIds: mf.symbols.map((s) => s.symbolId),
      assumptions: [],
      status: "ok",
    });
  }

  const stagedSet = new Set(stagedFiles);
  for (const mf of manifest.files) {
    const normTest = cleanRepoRelative(normalizeSlashes(mf.testPath));
    if (!stagedSet.has(normTest)) {
      missingReports.push({
        fileId: mf.fileId,
        testPath: normTest,
        outcome: "rejected",
        reason: "draft_missing",
        gates: [{ gate: "path", status: "skipped", detail: `Draft not found under "${config.local.stagingDir}".` }],
        tests: [],
        sha256: null,
      });
    }
  }

  const proposed = ProposedSchema.parse({
    schemaVersion: 1,
    runId: manifest.runId,
    headSha: manifest.headSha,
    model: config.model ?? null,
    files: proposedFiles,
  });

  const proposedChatPath = path.join(opts.workDir, "chat", "proposed.json");
  mkdirSync(path.dirname(proposedChatPath), { recursive: true });
  writeFileSync(proposedChatPath, `${JSON.stringify(proposed, null, 2)}\n`, "utf8");

  const attempt = opts.attempt ?? nextLocalAttemptNumber(opts.workDir);
  const maxAttempts = 1 + config.local.maxRepairIterations;
  const isFinal = attempt >= maxAttempts;

  const valRes = await runValidate({
    repoRoot: opts.repoRoot,
    workDir: opts.workDir,
    config,
    manifest,
    proposed,
    phase: opts.phase ?? "all",
    attempt,
    isFinalAttempt: isFinal,
    local: true,
    offline: config.offline.strategy === "unshare",
    wasmDir: opts.wasmDir,
    writeOutputs: false,
  });

  const allReportFiles = [...valRes.report.files, ...unmatchedReports, ...missingReports];
  const stageDirName =
    attempt <= 2 ? (attempt === 1 ? ARTIFACTS.validate1.dir : ARTIFACTS.validate2.dir) : `validate${attempt}`;
  if (unmatchedReports.length > 0 || missingReports.length > 0) {
    const mergedReport = { ...valRes.report, files: allReportFiles };
    writeFileSync(
      path.join(opts.workDir, stageDirName, "report.json"),
      `${JSON.stringify(mergedReport, null, 2)}\n`,
      "utf8",
    );
  }

  const summaryFiles: LocalValidateSummary["files"] = allReportFiles.map((fr) => {
    let outputTail: string | undefined;
    if (fr.outcome !== "accepted" && fr.outcome !== "accepted_pruned") {
      if (fr.logPath && existsSync(path.join(opts.workDir, fr.logPath))) {
        outputTail = readFileSync(path.join(opts.workDir, fr.logPath), "utf8").slice(-1200);
      } else {
        const failGate = fr.gates.find((g) => g.status === "fail");
        if (failGate?.detail) outputTail = failGate.detail.slice(0, 1200);
      }
    }
    return {
      fileId: fr.fileId,
      testPath: cleanRepoRelative(normalizeSlashes(fr.testPath)),
      outcome: fr.outcome,
      ...(fr.reason ? { reason: fr.reason } : {}),
      failingTests: fr.tests.filter((t) => t.status === "fail" || t.status === "flaky").map((t) => t.name),
      ...(fr.logPath ? { logPath: cleanRepoRelative(normalizeSlashes(fr.logPath)) } : {}),
      ...(fr.coverage ? { gainedLines: fr.coverage.gainedLines } : {}),
      ...(outputTail ? { outputTail } : {}),
    };
  });

  const hasAccepted = summaryFiles.some((f) => f.outcome === "accepted" || f.outcome === "accepted_pruned");
  const hasNeedsRepair = summaryFiles.some((f) => f.outcome === "needs_repair");

  let next = "No tests accepted.";
  if (valRes.report.environment) {
    next = "Environment error detected; run `local doctor --full` to diagnose.";
  } else if (hasNeedsRepair && !isFinal) {
    next = "Fix failing drafts in stagingDir and run `local validate` again.";
  } else if (hasAccepted) {
    next = "Present validation summary to user and run `local apply --confirm` after explicit approval.";
  }

  return LocalValidateSummarySchema.parse({
    schemaVersion: 1,
    attempt,
    maxAttempts,
    final: isFinal,
    environmentError: valRes.report.environment
      ? {
          command: valRes.report.environment.command,
          outputTail: valRes.report.environment.outputTail,
        }
      : null,
    files: summaryFiles,
    patchCoverage: {
      beforePct: valRes.report.patchCoverage.beforePct,
      projectedPct: valRes.report.patchCoverage.projectedPct,
    },
    next,
    truncated: false,
  });
}
