import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { hasProvenanceHeader, loadConfig, renderTestPathPattern, applyCollisionSuffix } from "../../config";
import {
  ARTIFACTS,
  ENVIRONMENT_FAILURE_REASONS,
  EXIT_CODES,
  FailuresSchema,
  FinalSchema,
  ProposedSchema,
  StageError,
  ToolVersionsSchema,
  ValidationReportSchema,
  type FailureReason,
  type Failures,
  type Final,
  type LanguageKey,
  type LoggerLike,
  type Manifest,
  type Proposed,
  type ToolVersions,
  type UnitAgentConfig,
  type ValidatedFileReport,
  type ValidationReport,
} from "../../contracts";
import { detectFrameworkForLanguage, sha256Hex } from "../../core/context";
import type { CoverageLineMap } from "../../core/coverage";
import { cleanupLeftoverPlacedFiles, recordPlacedFile, unrecordPlacedFile } from "../../local/placement";
import { cleanRepoRelative, isSafeRealPathInsideRoot, normalizeSlashes, toRepoPath } from "../../core/paths";
import { runStaticPolicyCheck } from "../../core/policy";
import { deriveFinalContent } from "../../core/prune";
import { buildLanguageToolVersions } from "../../languages/toolchains";
import { sanitizeFailureOutput, sanitizeOutput, writeGitHubOutput, writeStageStatus } from "../../telemetry";
import { deserializeCoverageLineMap, type BaselineArtifact } from "../baseline";
import { loadManifest } from "../detect";
import { computeProjectedPatchCoverage, evaluateFileCoverageGain } from "./coverage";
import { runFlakeCheck } from "./flake";
import { runFormatAndLintGate } from "./format";
import { runRunnerPreflight } from "./preflight";
import { runSingleFileTests, type RunnerTestCase } from "./runners";
import { listSnapshotFiles, storeSnapshotValidatedContent, writeValidationSnapshot } from "./snapshot";
import { prepareValidationWorkspace } from "./workspace";

export interface RunValidateOptions {
  repoRoot: string;
  workDir: string;
  configPath?: string;
  config?: UnitAgentConfig;
  manifestPath?: string;
  manifest?: Manifest;
  proposedPath?: string;
  proposed?: Proposed;
  phase?: "static" | "run" | "all";
  attempt?: number;
  isFinalAttempt?: boolean;
  local?: boolean;
  offline?: boolean;
  wasmDir?: string;
  logger?: LoggerLike;
  writeOutputs?: boolean;
}

function loadOrBuildToolVersions(repoRoot: string, workDir: string, config: UnitAgentConfig): ToolVersions {
  const toolsPath = path.join(workDir, ARTIFACTS.prepare.dir, "tools.json");
  if (existsSync(toolsPath)) {
    try {
      return ToolVersionsSchema.parse(JSON.parse(readFileSync(toolsPath, "utf8")));
    } catch {
      // rebuild below
    }
  }
  const languages: ToolVersions["languages"] = {};
  for (const lang of ["javascript", "python", "java"] as LanguageKey[]) {
    if (!config.languages[lang]?.enabled) continue;
    languages[lang] = buildLanguageToolVersions({ repoRoot, config, language: lang });
  }
  return ToolVersionsSchema.parse({
    agentNode: process.version,
    languages,
    warnings: [],
  });
}

function matchesAllowedTestPath(params: {
  testPath: string;
  sourcePath: string;
  language: LanguageKey;
  patterns: readonly string[];
  generatedSuffix: string;
  className?: string;
  packageName?: string;
}): boolean {
  const norm = cleanRepoRelative(normalizeSlashes(params.testPath));
  for (const pattern of params.patterns) {
    const baseRendered = renderTestPathPattern({
      language: params.language,
      sourcePath: params.sourcePath,
      pattern,
      className: params.className,
      packageName: params.packageName,
      generatedSuffix: params.generatedSuffix,
    });
    const collided = applyCollisionSuffix(baseRendered, params.language, params.generatedSuffix);
    if (norm === baseRendered || norm === collided) {
      return true;
    }
  }
  return false;
}

function storeFinalValidatedFile(workDir: string, testPath: string, content: string): void {
  const validatedPath = path.join(workDir, ARTIFACTS.final.dir, "validated", testPath);
  mkdirSync(path.dirname(validatedPath), { recursive: true });
  writeFileSync(validatedPath, content, "utf8");
}

function loadBaselineCoverageMap(workDir: string): CoverageLineMap | null {
  const baselinePath = path.join(workDir, ARTIFACTS.prepare.dir, "baseline.json");
  if (!existsSync(baselinePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(baselinePath, "utf8")) as BaselineArtifact;
    if (parsed && typeof parsed === "object" && parsed.lineHitsByFile) {
      return deserializeCoverageLineMap(parsed.lineHitsByFile);
    }
  } catch {
    // ignore invalid optional baseline artifact
  }
  return null;
}

function clearStaleCoverageFile(
  workspaceRoot: string,
  workingDirectory: string,
  coverageFile: string,
  sourcePath?: string,
): void {
  const covBase = coverageFile.replace(/^\.\//, "");
  const candidates = [
    path.resolve(workspaceRoot, coverageFile),
    path.resolve(workspaceRoot, workingDirectory || ".", coverageFile),
  ];
  if (sourcePath) {
    const srcMarker = sourcePath.indexOf("/src/");
    if (srcMarker > 0) {
      candidates.push(path.resolve(workspaceRoot, sourcePath.slice(0, srcMarker), covBase));
    }
  }
  for (const cand of candidates) {
    if (
      isSafeRealPathInsideRoot(path.relative(workspaceRoot, cand), workspaceRoot, { requireRegularFileIfExists: true })
    ) {
      try {
        rmSync(cand, { force: true });
      } catch {
        // best-effort stale coverage cleanup
      }
    }
  }
}

function normalizeJavaFailingNames(names: readonly string[]): string[] {
  return names.flatMap((n) => {
    const base = n.replace(/\([^)]*\)(?:\[[^\]]*\])?$/, "").trim();
    return base && base !== n ? [n, base] : [n];
  });
}

export async function runValidate(opts: RunValidateOptions): Promise<{
  report: ValidationReport;
  failures: Failures;
  finalArtifact: Final;
  acceptedContentsByPath: Record<string, string>;
}> {
  const config = opts.config ?? loadConfig(opts.repoRoot, opts.configPath).config;
  const manifest = opts.manifest ?? loadManifest(opts.workDir, opts.manifestPath);
  const attempt = Math.max(1, opts.attempt ?? 1);
  const snapAttempt: 1 | 2 = attempt === 1 ? 1 : 2;
  const maxAttempts = 1 + Math.max(0, config.limits.repairAttempts);
  const isFinalAttempt = opts.isFinalAttempt ?? attempt >= maxAttempts;
  const phase = opts.phase ?? "all";
  const stageName = attempt === 1 ? "validate1" : "validate2";
  const stageDirName =
    attempt <= 2 ? (attempt === 1 ? ARTIFACTS.validate1.dir : ARTIFACTS.validate2.dir) : `validate${attempt}`;
  const validateDir = path.join(opts.workDir, stageDirName);
  const logsDir = path.join(validateDir, "logs");
  mkdirSync(logsDir, { recursive: true });

  cleanupLeftoverPlacedFiles(opts.workDir, opts.repoRoot);

  const repairedPrimary = path.join(opts.workDir, ARTIFACTS.repaired.dir, "proposed.repaired.json");
  const repairedCompat = path.join(opts.workDir, ARTIFACTS.repaired.dir, "repaired.json");
  const defaultProposedPath =
    attempt === 1
      ? path.join(opts.workDir, ARTIFACTS.proposed.dir, "proposed.json")
      : existsSync(repairedPrimary)
        ? repairedPrimary
        : repairedCompat;

  let proposed = opts.proposed;
  if (!proposed) {
    const pPath = opts.proposedPath ?? defaultProposedPath;
    if (!existsSync(pPath)) {
      throw new StageError(
        `Proposed tests file not found: "${pPath}".`,
        EXIT_CODES.CONFIG_OR_INPUT,
        stageName,
        "missing_proposed",
      );
    }
    proposed = ProposedSchema.parse(JSON.parse(readFileSync(pPath, "utf8")));
  }

  const snapDirKey = snapAttempt === 1 ? ARTIFACTS.snapshot1.dir : ARTIFACTS.snapshot2.dir;
  const snapMetaPath = path.join(opts.workDir, snapDirKey, "snapshot.json");
  if (phase !== "run" || !existsSync(snapMetaPath)) {
    writeValidationSnapshot({
      workDir: opts.workDir,
      attempt: snapAttempt,
      proposed,
      mergeExisting: attempt >= 3,
    });
  }

  const baselineMap = loadBaselineCoverageMap(opts.workDir);
  const toolVersions = loadOrBuildToolVersions(opts.repoRoot, opts.workDir, config);
  const manifestById = new Map(manifest.files.map((f) => [f.fileId, f]));
  const knownSourceFiles = manifest.files.map((f) => f.path);

  const fileReports: ValidatedFileReport[] = [];
  const repairableFailures: Failures["files"] = [];
  const finalFiles: Final["files"] = [];
  const rejected: Final["rejected"] = [];
  const acceptedContentsByPath: Record<string, string> = {};
  const coverageMaps: CoverageLineMap[] = [];
  const notes: string[] = [];
  let envErrorBlock: ValidationReport["environment"] = null;

  const workspace =
    phase === "static"
      ? { root: opts.repoRoot, isCopy: false, cleanup: () => undefined }
      : prepareValidationWorkspace(opts.repoRoot, config, opts.local ? "local" : stageName);
  let staticFormatWorkspace: ReturnType<typeof prepareValidationWorkspace> | null = null;

  const preflightChecked = new Map<LanguageKey, { ok: boolean; reason?: FailureReason; detail: string }>();

  try {
    for (const pf of proposed.files) {
      const mf = manifestById.get(pf.fileId);
      if (!mf) {
        fileReports.push({
          fileId: pf.fileId,
          testPath: pf.testPath,
          outcome: "rejected",
          reason: "draft_missing",
          gates: [{ gate: "path", status: "fail", detail: "fileId missing from manifest" }],
          tests: [],
          sha256: null,
        });
        rejected.push({ testPath: pf.testPath, reason: "draft_missing" });
        continue;
      }

      if (pf.status !== "ok" || !pf.content.trim()) {
        fileReports.push({
          fileId: pf.fileId,
          testPath: pf.testPath,
          outcome: "rejected",
          reason: "draft_missing",
          gates: [{ gate: "static", status: "skipped", detail: `upstream status: ${pf.status}` }],
          tests: [],
          sha256: null,
        });
        rejected.push({ testPath: pf.testPath, reason: pf.error ?? pf.status });
        continue;
      }

      const langCfg = config.languages[mf.language];
      if (!langCfg || !langCfg.enabled) {
        fileReports.push({
          fileId: pf.fileId,
          testPath: pf.testPath,
          outcome: "rejected",
          reason: "unsupported_framework",
          gates: [{ gate: "preflight", status: "fail", detail: `Language ${mf.language} not enabled.` }],
          tests: [],
          sha256: null,
        });
        rejected.push({ testPath: pf.testPath, reason: "language not enabled" });
        continue;
      }

      const gates: ValidatedFileReport["gates"] = [];

      // Gate 1: Path & ownership check
      let safeTestRel: string;
      try {
        safeTestRel = toRepoPath(pf.testPath, opts.repoRoot);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        gates.push({ gate: "path", status: "fail", detail: msg });
        fileReports.push({
          fileId: pf.fileId,
          testPath: pf.testPath,
          outcome: "rejected",
          reason: "path_violation",
          gates,
          tests: [],
          sha256: null,
        });
        rejected.push({ testPath: pf.testPath, reason: "path_violation" });
        continue;
      }

      const safeInRepo = isSafeRealPathInsideRoot(safeTestRel, opts.repoRoot, {
        allowMissingLeaf: true,
        requireRegularFileIfExists: true,
      });
      const safeInWorkspace =
        phase === "static" ||
        isSafeRealPathInsideRoot(safeTestRel, workspace.root, {
          allowMissingLeaf: true,
          requireRegularFileIfExists: true,
        });
      if (!safeInRepo || !safeInWorkspace) {
        const detail = `Unsafe or symlinked target test path "${safeTestRel}".`;
        gates.push({ gate: "path", status: "fail", detail });
        fileReports.push({
          fileId: pf.fileId,
          testPath: safeTestRel,
          outcome: "rejected",
          reason: "path_violation",
          gates,
          tests: [],
          sha256: null,
        });
        rejected.push({ testPath: safeTestRel, reason: "path_violation" });
        continue;
      }

      const javaPackageName =
        /^package\s+([A-Za-z0-9_.]+)\s*;/.exec(mf.importHint)?.[1] ??
        /(?:^|\/)src\/(?:main|test)\/java\/(.+)\/[^/]+\.java$/.exec(mf.path)?.[1]?.replace(/\//g, ".");

      const allowedByPattern = matchesAllowedTestPath({
        testPath: safeTestRel,
        sourcePath: mf.path,
        language: mf.language,
        patterns: langCfg.testPathPatterns,
        generatedSuffix: langCfg.generatedSuffix,
        packageName: javaPackageName,
        className: mf.language === "java" ? path.posix.parse(mf.path).name : undefined,
      });

      const existingTargetAbs = path.join(opts.repoRoot, safeTestRel);
      const overwritesHumanFile =
        existsSync(existingTargetAbs) && !hasProvenanceHeader(readFileSync(existingTargetAbs, "utf8"));

      if (!allowedByPattern || overwritesHumanFile) {
        const detail = overwritesHumanFile
          ? `Refusing to overwrite non-agent test file "${safeTestRel}" (missing provenance header).`
          : `Test path "${safeTestRel}" does not match configured testPathPatterns.`;
        gates.push({ gate: "path", status: "fail", detail });
        fileReports.push({
          fileId: pf.fileId,
          testPath: safeTestRel,
          outcome: "rejected",
          reason: "path_violation",
          gates,
          tests: [],
          sha256: null,
        });
        rejected.push({ testPath: safeTestRel, reason: detail });
        continue;
      }
      gates.push({ gate: "path", status: "pass" });

      const targetSymbolNames = mf.symbols.map((s) => s.qualifiedName);
      // Gate 2: Static AST policy check
      const policyRes = await runStaticPolicyCheck({
        language: mf.language,
        testPath: safeTestRel,
        content: pf.content,
        importHint: mf.importHint,
        sourcePath: mf.path,
        targetSymbolNames,
        targetCount: mf.symbols.length,
        maxTestsPerSymbol: config.limits.maxTestsPerSymbol,
        extraBannedImports: config.policy.extraBannedImports,
        wasmDir: opts.wasmDir,
      });

      if (!policyRes.ok) {
        const detail = policyRes.violations.map((v) => `${v.rule}: ${v.message}`).join("; ");
        const isSyntax = policyRes.syntaxErrors && policyRes.violations[0]?.rule === "syntax_error";
        const failReason: FailureReason = isSyntax ? "compile_error" : "policy_violation";
        gates.push({ gate: "static", status: "fail", detail });
        fileReports.push({
          fileId: pf.fileId,
          testPath: safeTestRel,
          outcome: !isFinalAttempt && isSyntax ? "needs_repair" : "rejected",
          reason: failReason,
          gates,
          tests: [],
          sha256: null,
        });
        if (!isFinalAttempt && isSyntax) {
          repairableFailures.push({
            fileId: pf.fileId,
            failingTests: [],
            gate: "static",
            reason: "compile_error",
            output: detail.slice(0, 4000),
          });
        } else {
          rejected.push({ testPath: safeTestRel, reason: detail });
        }
        continue;
      }
      gates.push({ gate: "static", status: "pass" });

      const sourceAbs = path.join(opts.repoRoot, mf.path);
      const refSourceContent = existsSync(sourceAbs) ? readFileSync(sourceAbs, "utf8") : undefined;

      // Static-only phase runs format/lint commands in a disposable workspace if configured before freezing the snapshot
      if (phase === "static") {
        let fmtRes: Awaited<ReturnType<typeof runFormatAndLintGate>>;
        if (langCfg.formatCommand || langCfg.lintCommand) {
          staticFormatWorkspace ??= prepareValidationWorkspace(opts.repoRoot, config, opts.local ? "local" : stageName);
          if (
            !isSafeRealPathInsideRoot(safeTestRel, staticFormatWorkspace.root, {
              allowMissingLeaf: true,
              requireRegularFileIfExists: true,
            })
          ) {
            gates.push({ gate: "path", status: "fail", detail: `Unsafe path "${safeTestRel}" in format workspace.` });
            fileReports.push({
              fileId: pf.fileId,
              testPath: safeTestRel,
              outcome: "rejected",
              reason: "path_violation",
              gates,
              tests: [],
              sha256: null,
            });
            rejected.push({ testPath: safeTestRel, reason: "path_violation" });
            continue;
          }
          const fmtTestAbs = path.join(staticFormatWorkspace.root, safeTestRel);
          const existedInFmt = existsSync(fmtTestAbs);
          const priorInFmt = existedInFmt ? readFileSync(fmtTestAbs, "utf8") : null;
          try {
            mkdirSync(path.dirname(fmtTestAbs), { recursive: true });
            writeFileSync(fmtTestAbs, pf.content, "utf8");
            fmtRes = await runFormatAndLintGate({
              workspaceRoot: staticFormatWorkspace.root,
              repoRoot: opts.repoRoot,
              language: mf.language,
              langConfig: langCfg,
              config,
              testPath: safeTestRel,
              content: pf.content,
              referenceSourceContent: refSourceContent,
              runCommands: true,
            });
          } finally {
            if (
              isSafeRealPathInsideRoot(safeTestRel, staticFormatWorkspace.root, {
                allowMissingLeaf: true,
                requireRegularFileIfExists: true,
              })
            ) {
              if (existedInFmt && priorInFmt !== null) {
                writeFileSync(fmtTestAbs, priorInFmt, "utf8");
              } else {
                rmSync(fmtTestAbs, { force: true });
              }
            }
          }
        } else {
          fmtRes = await runFormatAndLintGate({
            workspaceRoot: workspace.root,
            repoRoot: opts.repoRoot,
            language: mf.language,
            langConfig: langCfg,
            config,
            testPath: safeTestRel,
            content: pf.content,
            referenceSourceContent: refSourceContent,
            runCommands: false,
          });
        }
        if (!fmtRes.ok) {
          gates.push({ gate: "format", status: "fail", detail: fmtRes.detail });
          if (fmtRes.reason === "environment_error") {
            envErrorBlock = {
              command: langCfg.lintCommand ?? langCfg.formatCommand ?? langCfg.testCommand,
              outputTail: sanitizeFailureOutput(fmtRes.detail ?? "", { repoRoot: opts.repoRoot }),
              reason: "environment_error",
            };
          }
          fileReports.push({
            fileId: pf.fileId,
            testPath: safeTestRel,
            outcome: fmtRes.reason === "environment_error" ? "environment_error" : "rejected",
            reason: fmtRes.reason ?? "lint_error",
            gates,
            tests: [],
            sha256: null,
          });
          rejected.push({ testPath: safeTestRel, reason: fmtRes.reason ?? "lint_error" });
          continue;
        }
        gates.push({ gate: "format", status: "pass" });
        if (langCfg.formatCommand) {
          const postFmtPolicy = await runStaticPolicyCheck({
            language: mf.language,
            testPath: safeTestRel,
            content: fmtRes.formattedContent,
            importHint: mf.importHint,
            sourcePath: mf.path,
            targetSymbolNames,
            targetCount: mf.symbols.length,
            maxTestsPerSymbol: config.limits.maxTestsPerSymbol,
            extraBannedImports: config.policy.extraBannedImports,
            wasmDir: opts.wasmDir,
          });
          if (!postFmtPolicy.ok) {
            const detail = postFmtPolicy.violations.map((v) => `${v.rule}: ${v.message}`).join("; ");
            gates.push({ gate: "static", status: "fail", detail: `Post-format policy failure: ${detail}` });
            fileReports.push({
              fileId: pf.fileId,
              testPath: safeTestRel,
              outcome: "rejected",
              reason: "policy_violation",
              gates,
              tests: [],
              sha256: null,
            });
            rejected.push({ testPath: safeTestRel, reason: detail });
            continue;
          }
        }
        storeSnapshotValidatedContent({
          workDir: opts.workDir,
          attempt: snapAttempt,
          testPath: safeTestRel,
          content: fmtRes.formattedContent,
        });
        gates.push({ gate: "preflight", status: "skipped" });
        gates.push({ gate: "snapshot", status: "skipped" });
        gates.push({ gate: "run", status: "skipped" });
        gates.push({ gate: "flake", status: "skipped" });
        gates.push({ gate: "coverage", status: "skipped" });

        storeFinalValidatedFile(opts.workDir, safeTestRel, fmtRes.formattedContent);
        acceptedContentsByPath[safeTestRel] = fmtRes.formattedContent;
        fileReports.push({
          fileId: pf.fileId,
          testPath: safeTestRel,
          outcome: "accepted",
          gates,
          tests: [],
          sha256: fmtRes.sha256,
          finalSha256: fmtRes.sha256,
        });
        finalFiles.push({
          path: safeTestRel,
          sha256: fmtRes.sha256,
          symbolIds: pf.symbolIds,
          testCount: policyRes.testCount,
          assumptions: pf.assumptions,
        });
        continue;
      }

      // Gate 0: Preflight per language BEFORE placing files into workspace
      let pre = preflightChecked.get(mf.language);
      if (!pre) {
        pre = await runRunnerPreflight({
          workspaceRoot: workspace.root,
          language: mf.language,
          langConfig: langCfg,
          config,
          phase,
        });
        preflightChecked.set(mf.language, pre);
      }

      if (!pre.ok) {
        gates.push({ gate: "format", status: "skipped" });
        gates.push({ gate: "preflight", status: "fail", detail: pre.detail });
        envErrorBlock = {
          command: langCfg.testCommand,
          outputTail: sanitizeFailureOutput(pre.detail, { repoRoot: workspace.root }),
          reason: pre.reason ?? "environment_error",
        };
        fileReports.push({
          fileId: pf.fileId,
          testPath: safeTestRel,
          outcome: "environment_error",
          reason: pre.reason ?? "environment_error",
          gates,
          tests: [],
          sha256: null,
        });
        rejected.push({ testPath: safeTestRel, reason: pre.reason ?? "environment_error" });
        continue;
      }

      const workspaceTestAbs = path.join(workspace.root, safeTestRel);
      const existedBeforeRun = existsSync(workspaceTestAbs);
      const priorWorkspaceContent = existedBeforeRun ? readFileSync(workspaceTestAbs, "utf8") : null;

      if (!workspace.isCopy && existedBeforeRun) {
        const msg = `Target test path "${safeTestRel}" already exists; refusing inplace placement.`;
        gates.push({ gate: "path", status: "fail", detail: msg });
        fileReports.push({
          fileId: pf.fileId,
          testPath: safeTestRel,
          outcome: "rejected",
          reason: "path_violation",
          gates,
          tests: [],
          sha256: null,
        });
        rejected.push({ testPath: safeTestRel, reason: msg });
        continue;
      }

      const fw = detectFrameworkForLanguage({
        language: mf.language,
        langConfig: langCfg,
        repoRoot: workspace.root,
      });

      const runnerReq = {
        workspaceRoot: workspace.root,
        repoRoot: opts.repoRoot,
        workDir: opts.workDir,
        languageConfig: langCfg,
        config,
        sourcePath: mf.path,
        testPath: safeTestRel,
        packageName: javaPackageName,
        javaTestClassName: mf.testClassName,
        withCoverage: true,
        offline: Boolean(opts.offline),
      };

      try {
        if (!workspace.isCopy) {
          recordPlacedFile(opts.workDir, safeTestRel, Boolean(opts.local));
        }
        const existingSnapFile = path.join(opts.workDir, snapDirKey, "validated", safeTestRel);
        const hasFrozenSnap = phase === "run" && existsSync(existingSnapFile);
        const initialContent = hasFrozenSnap ? readFileSync(existingSnapFile, "utf8") : pf.content;
        mkdirSync(path.dirname(workspaceTestAbs), { recursive: true });
        writeFileSync(workspaceTestAbs, initialContent, "utf8");

        const fmtRes = hasFrozenSnap
          ? { ok: true as const, formattedContent: initialContent, sha256: sha256Hex(initialContent) }
          : await runFormatAndLintGate({
              workspaceRoot: workspace.root,
              repoRoot: opts.repoRoot,
              language: mf.language,
              langConfig: langCfg,
              config,
              testPath: safeTestRel,
              content: pf.content,
              referenceSourceContent: refSourceContent,
              runCommands: true,
            });

        if (!fmtRes.ok) {
          gates.push({ gate: "format", status: "fail", detail: fmtRes.detail });
          if (fmtRes.reason === "environment_error") {
            envErrorBlock = {
              command: langCfg.lintCommand ?? langCfg.formatCommand ?? langCfg.testCommand,
              outputTail: sanitizeFailureOutput(fmtRes.detail ?? "", { repoRoot: workspace.root }),
              reason: "environment_error",
            };
          }
          fileReports.push({
            fileId: pf.fileId,
            testPath: safeTestRel,
            outcome: fmtRes.reason === "environment_error" ? "environment_error" : "rejected",
            reason: fmtRes.reason ?? "lint_error",
            gates,
            tests: [],
            sha256: null,
          });
          rejected.push({ testPath: safeTestRel, reason: fmtRes.reason ?? "lint_error" });
          continue;
        }
        gates.push({ gate: "format", status: "pass" });
        gates.push({ gate: "preflight", status: "pass" });

        if (!hasFrozenSnap && langCfg.formatCommand) {
          const postFmtPolicy = await runStaticPolicyCheck({
            language: mf.language,
            testPath: safeTestRel,
            content: fmtRes.formattedContent,
            importHint: mf.importHint,
            sourcePath: mf.path,
            targetSymbolNames,
            targetCount: mf.symbols.length,
            maxTestsPerSymbol: config.limits.maxTestsPerSymbol,
            extraBannedImports: config.policy.extraBannedImports,
            wasmDir: opts.wasmDir,
          });
          if (!postFmtPolicy.ok) {
            const detail = postFmtPolicy.violations.map((v) => `${v.rule}: ${v.message}`).join("; ");
            gates.push({ gate: "static", status: "fail", detail: `Post-format policy failure: ${detail}` });
            fileReports.push({
              fileId: pf.fileId,
              testPath: safeTestRel,
              outcome: "rejected",
              reason: "policy_violation",
              gates,
              tests: [],
              sha256: null,
            });
            rejected.push({ testPath: safeTestRel, reason: detail });
            continue;
          }
        }

        if (!hasFrozenSnap) {
          storeSnapshotValidatedContent({
            workDir: opts.workDir,
            attempt: snapAttempt,
            testPath: safeTestRel,
            content: fmtRes.formattedContent,
          });
        }

        const beforeSnaps = listSnapshotFiles(workspace.root);
        let currentContent = fmtRes.formattedContent;
        clearStaleCoverageFile(workspace.root, langCfg.workingDirectory, langCfg.coverageFile, mf.path);
        let runRes = await runSingleFileTests(fw.framework, runnerReq);
        const afterSnaps = listSnapshotFiles(workspace.root);

        const newSnaps = [...afterSnaps].filter((s) => !beforeSnaps.has(s));
        if (newSnaps.length > 0) {
          for (const snapRel of newSnaps) {
            if (isSafeRealPathInsideRoot(snapRel, workspace.root, { requireRegularFileIfExists: true })) {
              rmSync(path.join(workspace.root, snapRel), { force: true });
            }
          }
          gates.push({
            gate: "snapshot",
            status: "fail",
            detail: `Unintended snapshot files created: ${newSnaps.join(", ")}`,
          });
          fileReports.push({
            fileId: pf.fileId,
            testPath: safeTestRel,
            outcome: "rejected",
            reason: "policy_violation",
            gates,
            tests: [],
            sha256: null,
          });
          rejected.push({ testPath: safeTestRel, reason: `unintended snapshots: ${newSnaps.join(", ")}` });
          continue;
        }
        gates.push({ gate: "snapshot", status: "pass" });

        const logRel = normalizeSlashes(path.posix.join("logs", `${pf.fileId}.log`));
        const sanitizedLog = sanitizeOutput(`${runRes.stdout}\n${runRes.stderr}`, {
          repoRoot: workspace.root,
        });
        writeFileSync(path.join(validateDir, logRel), sanitizedLog, "utf8");

        let prunedTests: string[] = [];
        let testResults: ValidatedFileReport["tests"] = runRes.tests.map((t) => ({
          name: t.name,
          status: t.status,
        }));

        if (runRes.exitCode !== 0) {
          const reason = runRes.failureReason ?? "generated_test_failure";
          if (ENVIRONMENT_FAILURE_REASONS.has(reason) || reason === "timeout") {
            gates.push({ gate: "run", status: "fail", detail: runRes.failureDetail ?? reason });
            envErrorBlock = {
              command: runRes.commandString,
              outputTail: sanitizeFailureOutput(sanitizedLog, { repoRoot: workspace.root }),
              reason,
            };
            fileReports.push({
              fileId: pf.fileId,
              testPath: safeTestRel,
              outcome: "environment_error",
              reason,
              logPath: normalizeSlashes(path.posix.join(stageDirName, logRel)),
              gates,
              tests: testResults,
              sha256: null,
            });
            rejected.push({ testPath: safeTestRel, reason });
            continue;
          }

          const passingCases = runRes.tests.filter((t) => t.status === "pass");
          const failingCases = runRes.tests.filter((t) => t.status === "fail");

          // D25: Partial failure -> AST prune failing tests and re-verify on the final attempt
          if (isFinalAttempt && passingCases.length > 0 && failingCases.length > 0) {
            const failingNamesForPrune =
              mf.language === "java"
                ? normalizeJavaFailingNames(failingCases.map((t) => t.name))
                : failingCases.map((t) => t.name);
            const derived = await deriveFinalContent({
              language: mf.language,
              testPath: safeTestRel,
              content: currentContent,
              failingTestNames: failingNamesForPrune,
              repoRoot: opts.repoRoot,
              configEol: config.files.eol,
              provenanceHeader: config.policy.provenanceHeader,
              referenceSourceContent: refSourceContent,
              wasmDir: opts.wasmDir,
            });

            if (!derived.empty && derived.droppedCount > 0) {
              const postPrunePolicy = await runStaticPolicyCheck({
                language: mf.language,
                testPath: safeTestRel,
                content: derived.content,
                importHint: mf.importHint,
                sourcePath: mf.path,
                targetCount: mf.symbols.length,
                maxTestsPerSymbol: config.limits.maxTestsPerSymbol,
                extraBannedImports: config.policy.extraBannedImports,
                wasmDir: opts.wasmDir,
              });
              if (
                postPrunePolicy.ok &&
                isSafeRealPathInsideRoot(safeTestRel, workspace.root, {
                  allowMissingLeaf: true,
                  requireRegularFileIfExists: true,
                })
              ) {
                writeFileSync(workspaceTestAbs, derived.content, "utf8");
                clearStaleCoverageFile(workspace.root, langCfg.workingDirectory, langCfg.coverageFile, mf.path);
                const rerun = await runSingleFileTests(fw.framework, runnerReq);
                const afterRerunSnaps = listSnapshotFiles(workspace.root);
                const newRerunSnaps = [...afterRerunSnaps].filter((s) => !beforeSnaps.has(s));
                if (newRerunSnaps.length > 0) {
                  for (const snapRel of newRerunSnaps) {
                    if (isSafeRealPathInsideRoot(snapRel, workspace.root, { requireRegularFileIfExists: true })) {
                      rmSync(path.join(workspace.root, snapRel), { force: true });
                    }
                  }
                  gates.push({
                    gate: "snapshot",
                    status: "fail",
                    detail: `Unintended snapshot files created during prune rerun: ${newRerunSnaps.join(", ")}`,
                  });
                  fileReports.push({
                    fileId: pf.fileId,
                    testPath: safeTestRel,
                    outcome: "rejected",
                    reason: "policy_violation",
                    logPath: normalizeSlashes(path.posix.join(stageDirName, logRel)),
                    gates,
                    tests: testResults,
                    sha256: null,
                  });
                  rejected.push({ testPath: safeTestRel, reason: `unintended snapshots: ${newRerunSnaps.join(", ")}` });
                  continue;
                }
                const rerunReason = rerun.failureReason ?? "generated_test_failure";
                if (
                  rerun.exitCode !== 0 &&
                  (ENVIRONMENT_FAILURE_REASONS.has(rerunReason) || rerunReason === "timeout")
                ) {
                  gates.push({ gate: "run", status: "fail", detail: rerun.failureDetail ?? rerunReason });
                  envErrorBlock = {
                    command: rerun.commandString,
                    outputTail: sanitizeFailureOutput(`${rerun.stdout}\n${rerun.stderr}`, {
                      repoRoot: workspace.root,
                    }),
                    reason: rerunReason,
                  };
                  fileReports.push({
                    fileId: pf.fileId,
                    testPath: safeTestRel,
                    outcome: "environment_error",
                    reason: rerunReason,
                    logPath: normalizeSlashes(path.posix.join(stageDirName, logRel)),
                    gates,
                    tests: testResults,
                    sha256: null,
                  });
                  rejected.push({ testPath: safeTestRel, reason: rerunReason });
                  continue;
                }
                if (rerun.exitCode === 0) {
                  currentContent = derived.content;
                  prunedTests = derived.prunedNames;
                  runRes = rerun;
                  testResults = [
                    ...rerun.tests.map((t) => ({ name: t.name, status: t.status as "pass" })),
                    ...derived.prunedNames.map((n) => ({ name: n, status: "pruned" as const })),
                  ];
                }
              }
            }
          }

          if (runRes.exitCode !== 0) {
            gates.push({ gate: "run", status: "fail", detail: runRes.failureDetail ?? reason });
            const canRepair =
              !isFinalAttempt &&
              (reason === "compile_error" || reason === "import_error" || reason === "generated_test_failure");

            fileReports.push({
              fileId: pf.fileId,
              testPath: safeTestRel,
              outcome: canRepair ? "needs_repair" : "rejected",
              reason,
              logPath: normalizeSlashes(path.posix.join(stageDirName, logRel)),
              gates,
              tests: testResults,
              sha256: null,
            });
            if (canRepair) {
              repairableFailures.push({
                fileId: pf.fileId,
                failingTests: failingCases.map((f) => f.name),
                gate: "run",
                reason,
                output: sanitizeFailureOutput(sanitizedLog, { repoRoot: workspace.root }, 3800),
              });
            } else {
              rejected.push({ testPath: safeTestRel, reason });
            }
            continue;
          }
        }

        gates.push({ gate: "run", status: "pass" });

        // Gate 6: Flake check on passing tests
        const passingNames = testResults.filter((t) => t.status === "pass").map((t) => t.name);
        const flakeRes = await runFlakeCheck({
          framework: fw.framework,
          req: runnerReq,
          flakeRuns: config.limits.flakeRuns,
          passingTestNames: passingNames.length > 0 ? passingNames : ["suite"],
        });

        if (flakeRes.environmentFailure) {
          const ef = flakeRes.environmentFailure;
          gates.push({ gate: "flake", status: "fail", detail: ef.detail });
          envErrorBlock = {
            command: ef.command,
            outputTail: sanitizeFailureOutput(ef.output || ef.detail, { repoRoot: workspace.root }),
            reason: ef.reason,
          };
          fileReports.push({
            fileId: pf.fileId,
            testPath: safeTestRel,
            outcome: "environment_error",
            reason: ef.reason,
            logPath: normalizeSlashes(path.posix.join(stageDirName, logRel)),
            gates,
            tests: testResults,
            sha256: null,
          });
          rejected.push({ testPath: safeTestRel, reason: ef.reason });
          continue;
        }

        if (!flakeRes.ok) {
          // Try pruning individual flaky tests if named tests exist
          let survivedFlake = false;
          if (passingNames.length > flakeRes.flakyTestNames.length && flakeRes.flakyTestNames.length > 0) {
            const flakyNamesForPrune =
              mf.language === "java" ? normalizeJavaFailingNames(flakeRes.flakyTestNames) : flakeRes.flakyTestNames;
            const derivedFlake = await deriveFinalContent({
              language: mf.language,
              testPath: safeTestRel,
              content: currentContent,
              failingTestNames: flakyNamesForPrune,
              repoRoot: opts.repoRoot,
              configEol: config.files.eol,
              provenanceHeader: config.policy.provenanceHeader,
              referenceSourceContent: refSourceContent,
              wasmDir: opts.wasmDir,
            });
            if (!derivedFlake.empty && derivedFlake.droppedCount > 0) {
              const postFlakePolicy = await runStaticPolicyCheck({
                language: mf.language,
                testPath: safeTestRel,
                content: derivedFlake.content,
                importHint: mf.importHint,
                sourcePath: mf.path,
                targetSymbolNames,
                targetCount: mf.symbols.length,
                maxTestsPerSymbol: config.limits.maxTestsPerSymbol,
                extraBannedImports: config.policy.extraBannedImports,
                wasmDir: opts.wasmDir,
              });
              if (
                postFlakePolicy.ok &&
                isSafeRealPathInsideRoot(safeTestRel, workspace.root, {
                  allowMissingLeaf: true,
                  requireRegularFileIfExists: true,
                })
              ) {
                writeFileSync(workspaceTestAbs, derivedFlake.content, "utf8");
                const confirm = await runFlakeCheck({
                  framework: fw.framework,
                  req: runnerReq,
                  flakeRuns: config.limits.flakeRuns,
                  passingTestNames: passingNames.filter((n) => !flakeRes.flakyTestNames.includes(n)),
                });
                if (confirm.environmentFailure) {
                  const ef = confirm.environmentFailure;
                  gates.push({ gate: "flake", status: "fail", detail: ef.detail });
                  envErrorBlock = {
                    command: ef.command,
                    outputTail: sanitizeFailureOutput(ef.output || ef.detail, { repoRoot: workspace.root }),
                    reason: ef.reason,
                  };
                  fileReports.push({
                    fileId: pf.fileId,
                    testPath: safeTestRel,
                    outcome: "environment_error",
                    reason: ef.reason,
                    logPath: normalizeSlashes(path.posix.join(stageDirName, logRel)),
                    gates,
                    tests: testResults,
                    sha256: null,
                  });
                  rejected.push({ testPath: safeTestRel, reason: ef.reason });
                  continue;
                }
                if (confirm.ok) {
                  clearStaleCoverageFile(workspace.root, langCfg.workingDirectory, langCfg.coverageFile, mf.path);
                  const covRerun = await runSingleFileTests(fw.framework, { ...runnerReq, withCoverage: true });
                  const afterCovSnaps = listSnapshotFiles(workspace.root);
                  const newCovSnaps = [...afterCovSnaps].filter((s) => !beforeSnaps.has(s));
                  if (newCovSnaps.length > 0) {
                    for (const snapRel of newCovSnaps) {
                      if (isSafeRealPathInsideRoot(snapRel, workspace.root, { requireRegularFileIfExists: true })) {
                        rmSync(path.join(workspace.root, snapRel), { force: true });
                      }
                    }
                    gates.push({
                      gate: "snapshot",
                      status: "fail",
                      detail: `Unintended snapshot files created during flake rerun: ${newCovSnaps.join(", ")}`,
                    });
                    fileReports.push({
                      fileId: pf.fileId,
                      testPath: safeTestRel,
                      outcome: "rejected",
                      reason: "policy_violation",
                      logPath: normalizeSlashes(path.posix.join(stageDirName, logRel)),
                      gates,
                      tests: testResults,
                      sha256: null,
                    });
                    rejected.push({ testPath: safeTestRel, reason: `unintended snapshots: ${newCovSnaps.join(", ")}` });
                    continue;
                  }
                  const covReason = covRerun.failureReason ?? "generated_test_failure";
                  if (
                    covRerun.exitCode !== 0 &&
                    (ENVIRONMENT_FAILURE_REASONS.has(covReason) || covReason === "timeout")
                  ) {
                    gates.push({ gate: "run", status: "fail", detail: covRerun.failureDetail ?? covReason });
                    envErrorBlock = {
                      command: covRerun.commandString,
                      outputTail: sanitizeFailureOutput(`${covRerun.stdout}\n${covRerun.stderr}`, {
                        repoRoot: workspace.root,
                      }),
                      reason: covReason,
                    };
                    fileReports.push({
                      fileId: pf.fileId,
                      testPath: safeTestRel,
                      outcome: "environment_error",
                      reason: covReason,
                      logPath: normalizeSlashes(path.posix.join(stageDirName, logRel)),
                      gates,
                      tests: testResults,
                      sha256: null,
                    });
                    rejected.push({ testPath: safeTestRel, reason: covReason });
                    continue;
                  }
                  if (covRerun.exitCode === 0) {
                    currentContent = derivedFlake.content;
                    survivedFlake = true;
                    prunedTests.push(...derivedFlake.prunedNames);
                    testResults = testResults.map((t) =>
                      flakeRes.flakyTestNames.includes(t.name) ? { name: t.name, status: "flaky" as const } : t,
                    );
                  }
                }
              }
            }
          }

          if (!survivedFlake) {
            gates.push({
              gate: "flake",
              status: "fail",
              detail: `Flaky tests detected across ${config.limits.flakeRuns} runs: ${flakeRes.flakyTestNames.join(", ")}`,
            });
            fileReports.push({
              fileId: pf.fileId,
              testPath: safeTestRel,
              outcome: "rejected",
              reason: "flaky",
              logPath: normalizeSlashes(path.posix.join(stageDirName, logRel)),
              gates,
              tests: testResults,
              sha256: null,
            });
            rejected.push({ testPath: safeTestRel, reason: "flaky" });
            continue;
          }
        }
        gates.push({ gate: "flake", status: "pass" });

        // Gate 7: Coverage delta
        const covEval = evaluateFileCoverageGain({
          workspaceRoot: workspace.root,
          isCopy: workspace.isCopy,
          langConfig: langCfg,
          manifestFile: mf,
          knownSourceFiles,
          baselineMap,
        });

        if (covEval.coverageProduced && covEval.gainedLines === 0 && config.policy.dropZeroGainFiles) {
          gates.push({ gate: "coverage", status: "fail", detail: "Zero additional lines covered by generated tests." });
          fileReports.push({
            fileId: pf.fileId,
            testPath: safeTestRel,
            outcome: "rejected",
            reason: "no_coverage_gain",
            logPath: normalizeSlashes(path.posix.join(stageDirName, logRel)),
            gates,
            tests: testResults,
            sha256: null,
            coverage: { symbols: covEval.symbols, gainedLines: 0 },
          });
          rejected.push({ testPath: safeTestRel, reason: "no_coverage_gain" });
          continue;
        }
        if (covEval.afterMap) {
          coverageMaps.push(covEval.afterMap);
        }
        gates.push({ gate: "coverage", status: covEval.coverageProduced ? "pass" : "skipped" });

        const finalSha = sha256Hex(currentContent);
        const keptCount =
          testResults.filter((t) => t.status === "pass").length ||
          Math.max(1, policyRes.testCount - prunedTests.length);

        storeFinalValidatedFile(opts.workDir, safeTestRel, currentContent);
        acceptedContentsByPath[safeTestRel] = currentContent;

        const outcome = prunedTests.length > 0 ? "accepted_pruned" : "accepted";
        fileReports.push({
          fileId: pf.fileId,
          testPath: safeTestRel,
          outcome,
          logPath: normalizeSlashes(path.posix.join(stageDirName, logRel)),
          gates,
          tests: testResults,
          sha256: fmtRes.sha256,
          prunedTests: prunedTests.length > 0 ? prunedTests : undefined,
          finalSha256: finalSha,
          coverage: { symbols: covEval.symbols, gainedLines: covEval.gainedLines },
        });

        finalFiles.push({
          path: safeTestRel,
          sha256: finalSha,
          symbolIds: pf.symbolIds,
          testCount: keptCount,
          assumptions: pf.assumptions,
        });
      } finally {
        if (
          isSafeRealPathInsideRoot(safeTestRel, workspace.root, {
            allowMissingLeaf: true,
            requireRegularFileIfExists: true,
          })
        ) {
          if (existedBeforeRun && priorWorkspaceContent !== null) {
            writeFileSync(workspaceTestAbs, priorWorkspaceContent, "utf8");
          } else {
            rmSync(workspaceTestAbs, { force: true });
          }
        }
        if (!workspace.isCopy) {
          unrecordPlacedFile(opts.workDir, safeTestRel, Boolean(opts.local));
        }
      }
    }
  } finally {
    staticFormatWorkspace?.cleanup();
    workspace.cleanup();
  }

  const projectedPct =
    coverageMaps.length > 0
      ? computeProjectedPatchCoverage({
          manifestFiles: manifest.files,
          config,
          coverageMaps: baselineMap ? [baselineMap, ...coverageMaps] : coverageMaps,
        })
      : manifest.baseline.patchCoveragePct;

  const report = ValidationReportSchema.parse({
    schemaVersion: 1,
    attempt,
    workspace: phase === "static" ? config.validate.workspace : workspace.isCopy ? "copy" : "inplace",
    environment: envErrorBlock,
    files: fileReports,
    patchCoverage: {
      beforePct: manifest.baseline.patchCoveragePct,
      projectedPct,
    },
    toolVersions,
    notes,
  });

  const failures = FailuresSchema.parse({
    schemaVersion: 1,
    files: repairableFailures,
  });

  // Load any previously accepted files from attempt 1 if this is validate-2 so final.json merges cleanly
  let mergedFinalFiles = [...finalFiles];
  const finalJsonPath = path.join(opts.workDir, ARTIFACTS.final.dir, "final.json");
  if (attempt >= 2 && existsSync(finalJsonPath)) {
    try {
      const prevFinal = FinalSchema.parse(JSON.parse(readFileSync(finalJsonPath, "utf8")));
      const byPath = new Map(prevFinal.files.map((f) => [f.path, f]));
      const finalValidatedDir = path.join(opts.workDir, ARTIFACTS.final.dir, "validated");
      for (const fr of fileReports) {
        if (fr.outcome !== "accepted" && fr.outcome !== "accepted_pruned") {
          byPath.delete(fr.testPath);
          if (isSafeRealPathInsideRoot(fr.testPath, finalValidatedDir, { requireRegularFileIfExists: true })) {
            rmSync(path.join(finalValidatedDir, fr.testPath), { force: true });
          }
        }
      }
      for (const nf of finalFiles) byPath.set(nf.path, nf);
      mergedFinalFiles = [...byPath.values()];
    } catch {
      // ignore invalid previous final
    }
  }

  const finalArtifact = FinalSchema.parse({
    schemaVersion: 1,
    runId: manifest.runId,
    repo: manifest.repo,
    pr: manifest.pr,
    headSha: manifest.headSha,
    headRef: process.env.GITHUB_HEAD_REF || "HEAD",
    mode: config.mode,
    files: mergedFinalFiles,
    patchCoverage: {
      beforePct: manifest.baseline.patchCoveragePct,
      projectedPct,
      targetPct: config.targets.patchCoverage,
    },
    toolVersions,
    notes,
    rejected,
  });

  writeFileSync(path.join(validateDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(path.join(validateDir, "failures.json"), `${JSON.stringify(failures, null, 2)}\n`, "utf8");
  mkdirSync(path.dirname(finalJsonPath), { recursive: true });
  writeFileSync(finalJsonPath, `${JSON.stringify(finalArtifact, null, 2)}\n`, "utf8");

  writeStageStatus(opts.workDir, {
    stage: stageName,
    status: "ok",
    reason: `accepted_${finalFiles.length}_repair_${repairableFailures.length}_rejected_${rejected.length}`,
  });

  if (opts.writeOutputs !== false) {
    const needsRepairOut =
      envErrorBlock !== null ? "" : !isFinalAttempt && repairableFailures.length > 0 ? "true" : "false";
    writeGitHubOutput({
      accepted_count: finalFiles.length,
      needs_repair_count: repairableFailures.length,
      needs_repair: needsRepairOut,
      rejected_count: rejected.length,
      environment_error: String(envErrorBlock !== null),
      status: "ok",
    });
  }

  return { report, failures, finalArtifact, acceptedContentsByPath };
}

export type RunnerCaseStatus = RunnerTestCase;
