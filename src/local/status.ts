import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

  const manifestMtime = existsSync(manifestPath) ? statSync(manifestPath).mtimeMs : -1;
  const validateIsFresh =
    latestValidate !== null && (manifestMtime < 0 || statSync(latestValidate.reportPath).mtimeMs >= manifestMtime);
  const proposedIsFresh =
    existsSync(proposedChatPath) && (manifestMtime < 0 || statSync(proposedChatPath).mtimeMs >= manifestMtime);

  const hasFreshStagedFile = (dirAbs: string): boolean => {
    if (!existsSync(dirAbs)) return false;
    const stack = [dirAbs];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const ent of readdirSync(cur, { withFileTypes: true })) {
        if (ent.isSymbolicLink()) continue;
        const full = path.join(cur, ent.name);
        if (ent.isDirectory()) {
          stack.push(full);
        } else if (ent.isFile()) {
          const st = statSync(full);
          if (st.size > 0 && (manifestMtime < 0 || st.mtimeMs >= manifestMtime)) {
            return true;
          }
        }
      }
    }
    return false;
  };
  const stagingAbs = path.resolve(opts.repoRoot, config.local.stagingDir);
  const stagedIsFresh = hasFreshStagedFile(stagingAbs);

  const appliedMtime = existsSync(appliedPath) ? statSync(appliedPath).mtimeMs : -1;
  const newerUpstreamMtimes = [
    manifestMtime,
    existsSync(proposedChatPath) ? statSync(proposedChatPath).mtimeMs : -1,
    latestValidate ? statSync(latestValidate.reportPath).mtimeMs : -1,
  ];
  const appliedIsFresh = appliedMtime >= 0 && newerUpstreamMtimes.every((t) => t <= appliedMtime);

  let stage: LocalStatusSummary["stage"] = "none";
  if (appliedIsFresh) {
    stage = "applied";
  } else if (validateIsFresh) {
    stage = "validated";
  } else if (proposedIsFresh || stagedIsFresh) {
    stage = "drafted";
  } else if (existsSync(manifestPath)) {
    stage = "detected";
  }

  const files: LocalStatusSummary["files"] = [];
  if (validateIsFresh && latestValidate) {
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

  // Flag any drafts inside stagingDir that appear in `git status --porcelain -z` (they should not)
  const stagingRel = cleanRepoRelative(normalizeSlashes(config.local.stagingDir));
  const stagedFilesInGitStatus: string[] = [];
  const gitRes = await runCommand("git", ["status", "--porcelain", "-z", "--untracked-files=all"], {
    cwd: opts.repoRoot,
  });
  if (gitRes.exitCode === 0) {
    const entries = gitRes.stdout.split("\0");
    for (let i = 0; i < entries.length; i += 1) {
      const rec = entries[i] ?? "";
      if (rec.length < 4) continue;
      const statusXY = rec.slice(0, 2);
      const rawPath = rec.slice(3);
      if (!rawPath) continue;
      const norm = cleanRepoRelative(normalizeSlashes(rawPath));
      if (norm === stagingRel || norm.startsWith(`${stagingRel}/`)) {
        stagedFilesInGitStatus.push(norm);
      }
      // Renames/copies emit an additional NUL-delimited original path entry
      if (statusXY.includes("R") || statusXY.includes("C")) {
        i += 1;
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
    attempt: validateIsFresh ? (latestValidate?.attempt ?? null) : null,
    files,
    stagedFilesInGitStatus,
    next,
  });
}
