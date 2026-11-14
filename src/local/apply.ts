import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "../config";
import {
  ARTIFACTS,
  EXIT_CODES,
  LocalApplySummarySchema,
  ManifestSchema,
  StageError,
  ValidationReportSchema,
  type ExitCode,
  type LocalApplySummary,
  type UnitAgentConfig,
  type ValidationReport,
} from "../contracts";
import { sha256Hex } from "../core/context";
import { cleanRepoRelative, normalizeSlashes, toRepoPath } from "../core/paths";
import { runStaticPolicyCheck } from "../core/policy";
import { deriveFinalContent } from "../core/prune";
import { runCommand } from "../exec/exec";
import { inferLanguageForTestPath } from "../github";

export interface RunLocalApplyOptions {
  repoRoot: string;
  workDir: string;
  configPath?: string;
  config?: UnitAgentConfig;
  confirm?: boolean;
  stage?: boolean;
  files?: string[];
  wasmDir?: string;
}

export interface RunLocalApplyResult {
  summary: LocalApplySummary;
  exitCode: ExitCode;
}

function findLatestReport(workDir: string): { attempt: number; report: ValidationReport } {
  if (!existsSync(workDir)) {
    throw new StageError(
      "No validation reports found. Run `local validate` first.",
      EXIT_CODES.CONFIG_OR_INPUT,
      "local",
      "missing_report",
    );
  }
  let maxN = 0;
  let bestPath = "";
  for (const ent of readdirSync(workDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const match = /^validate(\d+)$/.exec(ent.name);
    if (!match) continue;
    const n = Number.parseInt(match[1] ?? "0", 10);
    const p = path.join(workDir, ent.name, "report.json");
    if (n > maxN && existsSync(p)) {
      maxN = n;
      bestPath = p;
    }
  }
  if (!bestPath) {
    throw new StageError(
      "No validation report found. Run `local validate` first.",
      EXIT_CODES.CONFIG_OR_INPUT,
      "local",
      "missing_report",
    );
  }
  return {
    attempt: maxN,
    report: ValidationReportSchema.parse(JSON.parse(readFileSync(bestPath, "utf8"))),
  };
}

function resolveValidatedArtifactContent(workDir: string, attempt: number, testPath: string): string | null {
  const candidates = [
    path.join(workDir, ARTIFACTS.final.dir, "validated", testPath),
    path.join(workDir, attempt <= 1 ? ARTIFACTS.snapshot1.dir : ARTIFACTS.snapshot2.dir, "validated", testPath),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  return null;
}

export async function runLocalApply(opts: RunLocalApplyOptions): Promise<RunLocalApplyResult> {
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
  const { attempt, report } = findLatestReport(opts.workDir);

  const filterSet = opts.files && opts.files.length > 0 ? new Set(opts.files) : null;
  const selected = report.files.filter(
    (fr) => !filterSet || filterSet.has(fr.fileId) || filterSet.has(cleanRepoRelative(normalizeSlashes(fr.testPath))),
  );

  const written: LocalApplySummary["written"] = [];
  const refused: LocalApplySummary["refused"] = [];

  if (!opts.confirm) {
    for (const fr of selected) {
      if (fr.outcome === "accepted" || fr.outcome === "accepted_pruned") {
        written.push({
          path: cleanRepoRelative(normalizeSlashes(fr.testPath)),
          sha256: fr.finalSha256 ?? fr.sha256 ?? "",
        });
      } else {
        refused.push({ path: cleanRepoRelative(normalizeSlashes(fr.testPath)), reason: "not_accepted" });
      }
    }
    return {
      summary: LocalApplySummarySchema.parse({
        schemaVersion: 1,
        dryRun: true,
        written,
        refused,
        staged: false,
        next:
          written.length > 0
            ? "Re-run `local apply --confirm` to write these files to the repository."
            : "No accepted files to apply.",
      }),
      exitCode: EXIT_CODES.OK,
    };
  }

  const manifestById = new Map(manifest.files.map((m) => [m.fileId, m]));
  let exitCode: ExitCode = EXIT_CODES.OK;

  for (const fr of selected) {
    const cleanTestPath = cleanRepoRelative(normalizeSlashes(fr.testPath));
    if (fr.outcome !== "accepted" && fr.outcome !== "accepted_pruned") {
      refused.push({ path: cleanTestPath, reason: "not_accepted" });
      continue;
    }

    // 1. Verify validated content & SHA-256 (or deriveFinalContent for accepted_pruned)
    const rawValidated = resolveValidatedArtifactContent(opts.workDir, attempt, cleanTestPath);
    if (rawValidated === null) {
      refused.push({ path: cleanTestPath, reason: "hash_mismatch" });
      exitCode = EXIT_CODES.POLICY_OR_HASH;
      continue;
    }

    let finalContent = rawValidated;
    const expectedHash = fr.finalSha256 ?? fr.sha256;
    const mf = manifestById.get(fr.fileId);
    const lang = mf?.language ?? inferLanguageForTestPath(cleanTestPath);

    if (fr.outcome === "accepted_pruned" && fr.prunedTests && fr.prunedTests.length > 0) {
      const snapFile = path.join(
        opts.workDir,
        attempt <= 1 ? ARTIFACTS.snapshot1.dir : ARTIFACTS.snapshot2.dir,
        "validated",
        cleanTestPath,
      );
      if (existsSync(snapFile)) {
        const snapBytes = readFileSync(snapFile, "utf8");
        const derived = await deriveFinalContent({
          language: lang,
          testPath: cleanTestPath,
          content: snapBytes,
          failingTestNames: fr.prunedTests,
          repoRoot: opts.repoRoot,
          configEol: config.files.eol,
          provenanceHeader: config.policy.provenanceHeader,
          wasmDir: opts.wasmDir,
        });
        if (fr.finalSha256 && sha256Hex(derived.content) !== fr.finalSha256) {
          refused.push({ path: cleanTestPath, reason: "hash_mismatch" });
          exitCode = EXIT_CODES.POLICY_OR_HASH;
          continue;
        }
        finalContent = derived.content;
      } else if (!expectedHash || sha256Hex(finalContent) !== expectedHash) {
        refused.push({ path: cleanTestPath, reason: "hash_mismatch" });
        exitCode = EXIT_CODES.POLICY_OR_HASH;
        continue;
      }
    } else if (!expectedHash || sha256Hex(finalContent) !== expectedHash) {
      refused.push({ path: cleanTestPath, reason: "hash_mismatch" });
      exitCode = EXIT_CODES.POLICY_OR_HASH;
      continue;
    }

    // 2. Re-run Gates 1 and 2
    let safeRel: string;
    try {
      safeRel = toRepoPath(cleanTestPath, opts.repoRoot);
    } catch {
      refused.push({ path: cleanTestPath, reason: "policy" });
      exitCode = EXIT_CODES.POLICY_OR_HASH;
      continue;
    }
    const policyRes = await runStaticPolicyCheck({
      language: lang,
      testPath: safeRel,
      content: finalContent,
      importHint: mf?.importHint,
      sourcePath: mf?.path,
      targetCount: Math.max(1, mf?.symbols.length ?? 1),
      maxTestsPerSymbol: config.limits.maxTestsPerSymbol,
      extraBannedImports: config.policy.extraBannedImports,
      wasmDir: opts.wasmDir,
    });
    if (!policyRes.ok) {
      refused.push({ path: safeRel, reason: "policy" });
      exitCode = EXIT_CODES.POLICY_OR_HASH;
      continue;
    }

    // 3. Recompute source file SHA-256 vs manifest.sourceSha256 -> exit 50
    if (mf) {
      const srcAbs = path.join(opts.repoRoot, mf.path);
      if (!existsSync(srcAbs) || sha256Hex(readFileSync(srcAbs, "utf8")) !== mf.sourceSha256) {
        refused.push({ path: safeRel, reason: "source_changed" });
        if (exitCode === EXIT_CODES.OK) exitCode = EXIT_CODES.STALE_HEAD_OR_SOURCE;
        continue;
      }
    }

    // 4. Refuse if target path now exists
    const targetAbs = path.join(opts.repoRoot, safeRel);
    if (existsSync(targetAbs)) {
      refused.push({ path: safeRel, reason: "target_exists" });
      continue;
    }

    // 5. Write validated content (never staged draft)
    mkdirSync(path.dirname(targetAbs), { recursive: true });
    writeFileSync(targetAbs, finalContent, "utf8");
    written.push({ path: safeRel, sha256: sha256Hex(finalContent) });
  }

  // Clean staging directory when files applied cleanly (no source_changed / hash_mismatch failures)
  const stagingAbs = path.resolve(opts.repoRoot, config.local.stagingDir);
  if (written.length > 0 && existsSync(stagingAbs)) {
    for (const ent of readdirSync(stagingAbs)) {
      rmSync(path.join(stagingAbs, ent), { recursive: true, force: true });
    }
  }

  let staged = false;
  if ((opts.stage || config.local.stageApplied) && written.length > 0) {
    const addRes = await runCommand("git", ["add", "--", ...written.map((w) => w.path)], {
      cwd: opts.repoRoot,
    });
    staged = addRes.exitCode === 0;
  }

  const appliedJson = path.join(opts.workDir, "chat", "applied.json");
  mkdirSync(path.dirname(appliedJson), { recursive: true });
  writeFileSync(
    appliedJson,
    `${JSON.stringify({ schemaVersion: 1, appliedAt: new Date().toISOString(), written, refused, staged }, null, 2)}\n`,
    "utf8",
  );

  const summary = LocalApplySummarySchema.parse({
    schemaVersion: 1,
    dryRun: false,
    written,
    refused,
    staged,
    next:
      exitCode === EXIT_CODES.STALE_HEAD_OR_SOURCE
        ? "Source code changed after detect; run `local detect` and re-validate."
        : exitCode === EXIT_CODES.POLICY_OR_HASH
          ? "Artifact integrity or policy verification failed; inspect refused items and re-validate."
          : written.length > 0
            ? "Review `git diff`, run your full test suite, and commit changes yourself."
            : "No files were written.",
  });

  return { summary, exitCode };
}
