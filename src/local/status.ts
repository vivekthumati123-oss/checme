import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "../config";
import { ARTIFACTS, LocalStatusSummarySchema, ValidationReportSchema, type LocalStatusSummary } from "../contracts";
import { cleanRepoRelative, normalizeSlashes } from "../core/paths";
import { runCommand } from "../exec/exec";
import { cleanupLeftoverPlacedFiles } from "./placement";

export interface RunLocalStatusOptions {
  repoRoot: string;
  workDir: string;
  configPath?: string;
}

function findHighestValidateAttempt(workDir: string): { attempt: number; reportPath: string } | null {
  if (!existsSync(workDir)) return null;
  let maxAttempt = 0;
  let reportPath = "";
  for (const ent of readdirSync(workDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const match = /^validate(\d+)$/.exec(ent.name);
    if (!match) continue;
    const n = Number.parseInt(match[1] ?? "0", 10);
    const candidate = path.join(workDir, ent.name, "report.json");
    if (n > maxAttempt && existsSync(candidate)) {
      maxAttempt = n;
      reportPath = candidate;
    }
  }
  return maxAttempt > 0 ? { attempt: maxAttempt, reportPath } : null;
}

export async function runLocalStatus(opts: RunLocalStatusOptions): Promise<LocalStatusSummary> {
  cleanupLeftoverPlacedFiles(opts.workDir, opts.repoRoot);
  const config = loadConfig(opts.repoRoot, opts.configPath).config;

  const manifestPath = path.join(opts.workDir, ARTIFACTS.prepare.dir, "manifest.json");
  const proposedChatPath = path.join(opts.workDir, "chat", "proposed.json");
  const appliedPath = path.join(opts.workDir, "chat", "applied.json");
  const latestValidate = findHighestValidateAttempt(opts.workDir);

  let stage: LocalStatusSummary["stage"] = "none";
  if (existsSync(appliedPath)) {
    stage = "applied";
  } else if (latestValidate) {
    stage = "validated";
  } else if (existsSync(proposedChatPath)) {
    stage = "drafted";
  } else if (existsSync(manifestPath)) {
    stage = "detected";
  }

  const files: LocalStatusSummary["files"] = [];
  if (latestValidate) {
    try {
      const report = ValidationReportSchema.parse(JSON.parse(readFileSync(latestValidate.reportPath, "utf8")));
      for (const fr of report.files) {
        files.push({
          fileId: fr.fileId,
          testPath: cleanRepoRelative(normalizeSlashes(fr.testPath)),
          outcome: fr.outcome,
        });
      }
    } catch {
      // ignore invalid report
    }
  }

  // Flag any drafts inside stagingDir that appear in `git status --porcelain` (they should not)
  const stagingRel = cleanRepoRelative(normalizeSlashes(config.local.stagingDir));
  const stagedFilesInGitStatus: string[] = [];
  const gitRes = await runCommand("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: opts.repoRoot,
  });
  if (gitRes.exitCode === 0) {
    for (const line of gitRes.stdout.split(/\r?\n/)) {
      const rawPath = line.slice(3).trim();
      if (!rawPath) continue;
      const norm = cleanRepoRelative(normalizeSlashes(rawPath));
      if (norm === stagingRel || norm.startsWith(`${stagingRel}/`)) {
        stagedFilesInGitStatus.push(norm);
      }
    }
  }

  let next = "Run `local detect` to find targets.";
  if (stage === "detected") next = "Draft test files under stagingDir, then run `local validate`.";
  else if (stage === "drafted") next = "Run `local validate` to verify drafts.";
  else if (stage === "validated") {
    const hasNeedsRepair = files.some((f) => f.outcome === "needs_repair");
    next = hasNeedsRepair
      ? "Fix failing drafts and re-run `local validate`, or run `local apply` on accepted files."
      : "Review validated files and run `local apply --confirm`.";
  } else if (stage === "applied") {
    next = "Review `git diff`, run your full test suite, and commit.";
  }

  return LocalStatusSummarySchema.parse({
    schemaVersion: 1,
    stage,
    attempt: latestValidate?.attempt ?? null,
    files,
    stagedFilesInGitStatus,
    next,
  });
}
