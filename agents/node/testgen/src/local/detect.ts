import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";

import { loadConfig } from "../config";
import {
  ARTIFACTS,
  EXIT_CODES,
  LocalDetectSummarySchema,
  StageError,
  type LanguageKey,
  type LocalDetectSummary,
  type Manifest,
  type PlanOutput,
  type UnitAgentConfig,
} from "../contracts";
import { parseCoverageFile } from "../core/coverage";
import { cleanRepoRelative, normalizeSlashes } from "../core/paths";
import { runCommand } from "../exec/exec";
import { runBaseline, serializeCoverageLineMap, type BaselineArtifact } from "../stages/baseline";
import { runDetect } from "../stages/detect";

export interface RunLocalDetectOptions {
  repoRoot: string;
  workDir: string;
  configPath?: string;
  config?: UnitAgentConfig;
  scope?: "staged" | "worktree" | "branch" | "files";
  baseRef?: string;
  files?: string[];
  symbols?: string[];
  includeCovered?: boolean;
  skipBaseline?: boolean;
  coverageFile?: string;
  wasmDir?: string;
}

function getLatestSourceMtimeMs(
  repoRoot: string,
  workingDir: string,
  sourceGlobs: readonly string[],
  excludeGlobs: readonly string[],
  files?: readonly string[],
): number {
  let latest = 0;
  const hasGlob = Boolean(files?.some((f) => /[*?[\]{}!]/.test(f)));
  if (files && files.length > 0 && !hasGlob) {
    for (const rel of files) {
      const abs = path.join(repoRoot, rel);
      if (existsSync(abs)) {
        latest = Math.max(latest, statSync(abs).mtimeMs);
      }
    }
    return latest;
  }
  const filesMatcher =
    files && files.length > 0
      ? picomatch(
          files.map((g) => cleanRepoRelative(normalizeSlashes(g))),
          { dot: true, nocase: process.platform === "win32" },
        )
      : null;
  const wdAbs = path.resolve(repoRoot, workingDir || ".");
  if (!existsSync(wdAbs)) return latest;
  const srcMatcher = picomatch(
    sourceGlobs.map((g) => cleanRepoRelative(normalizeSlashes(g))),
    { dot: true, nocase: process.platform === "win32" },
  );
  const excMatcher = picomatch([...excludeGlobs], { dot: true, nocase: process.platform === "win32" });
  const stack = [wdAbs];
  let visitedDirs = 0;
  while (stack.length > 0 && visitedDirs < 1000) {
    visitedDirs += 1;
    const cur = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      if (
        ent.name === ".git" ||
        ent.name === "node_modules" ||
        ent.name === ".unit-agent" ||
        ent.name === "target" ||
        ent.name === "build" ||
        ent.name === "dist"
      ) {
        continue;
      }
      const full = path.join(cur, ent.name);
      const repoRel = cleanRepoRelative(normalizeSlashes(path.relative(repoRoot, full)));
      if (excMatcher(repoRel)) continue;
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile()) {
        const wdRel = cleanRepoRelative(normalizeSlashes(path.relative(wdAbs, full)));
        if (srcMatcher(wdRel) && (!filesMatcher || filesMatcher(repoRel))) {
          latest = Math.max(latest, statSync(full).mtimeMs);
        }
      }
    }
  }
  return latest;
}

async function resolveDefaultBranchBaseRef(repoRoot: string): Promise<string> {
  const sym = await runCommand("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: repoRoot });
  if (sym.exitCode === 0 && sym.stdout.trim()) return sym.stdout.trim();
  const hasMain = await runCommand("git", ["rev-parse", "--verify", "main"], { cwd: repoRoot });
  if (hasMain.exitCode === 0) return "main";
  const hasMaster = await runCommand("git", ["rev-parse", "--verify", "master"], { cwd: repoRoot });
  return hasMaster.exitCode === 0 ? "master" : "HEAD";
}

export async function runLocalDetect(opts: RunLocalDetectOptions): Promise<{
  manifest: Manifest;
  summary: LocalDetectSummary;
}> {
  const config = opts.config ?? loadConfig(opts.repoRoot, opts.configPath).config;
  const scope = opts.scope ?? "branch";
  const baseRef =
    scope === "branch"
      ? (opts.baseRef ?? config.local.baseRef ?? (await resolveDefaultBranchBaseRef(opts.repoRoot)))
      : null;

  const enabledLangs: LanguageKey[] = (["javascript", "python", "java"] as LanguageKey[]).filter((l) =>
    Boolean(config.languages[l]?.enabled),
  );
  const plan: PlanOutput = {
    schemaVersion: 1,
    languages: enabledLangs,
    toolchains: {},
    frameworks: {},
    skipped: [],
    warnings: [],
  };

  let baselineStatus: "green" | "red" | "no_coverage" | "skipped" = "no_coverage";
  let reusedCoverage = false;
  let baseline: BaselineArtifact | undefined;

  if (opts.coverageFile) {
    if (opts.coverageFile.includes("\0") || opts.coverageFile.replace(/\\/g, "/").split("/").includes("..")) {
      throw new StageError(
        `Unsafe coverage file path: "${opts.coverageFile}".`,
        EXIT_CODES.POLICY_OR_HASH,
        "local",
        "path_violation",
      );
    }
    const covAbs = path.isAbsolute(opts.coverageFile)
      ? opts.coverageFile
      : path.resolve(opts.repoRoot, opts.coverageFile);
    if (!existsSync(covAbs)) {
      throw new StageError(
        `Coverage file not found: "${opts.coverageFile}".`,
        EXIT_CODES.CONFIG_OR_INPUT,
        "local",
        "missing_coverage_file",
      );
    }
    const mergedHits = new Map<string, Map<number, number>>();
    for (const lang of enabledLangs) {
      const lc = config.languages[lang]!;
      const parsed = parseCoverageFile({
        filePath: covAbs,
        format: lc.coverageFormat,
        repoRoot: opts.repoRoot,
        workingDirectory: lc.workingDirectory,
        knownSourceFiles: opts.files ?? [],
      });
      if (parsed) {
        for (const [k, v] of parsed.entries()) mergedHits.set(k, v);
      }
    }
    baselineStatus = mergedHits.size > 0 ? "green" : "no_coverage";
    reusedCoverage = mergedHits.size > 0;
    baseline = {
      schemaVersion: 1,
      status: baselineStatus === "green" ? "green" : "no_coverage",
      perLanguage: Object.fromEntries(
        enabledLangs.map((l) => [
          l,
          { status: baselineStatus === "green" ? "green" : "no_coverage", patchCoveragePct: null },
        ]),
      ),
      patchCoveragePct: null,
      lineHitsByFile: serializeCoverageLineMap(mergedHits),
    };
  } else if (opts.skipBaseline || config.baseline.mode === "skip") {
    baselineStatus = "skipped";
    baseline = {
      schemaVersion: 1,
      status: "no_coverage",
      perLanguage: Object.fromEntries(enabledLangs.map((l) => [l, { status: "no_coverage", patchCoveragePct: null }])),
      patchCoveragePct: null,
      lineHitsByFile: {},
    };
  } else {
    // Check if reusable coverage exists and is newer than source files
    let canReuseAll = config.local.reuseCoverage && enabledLangs.length > 0;
    const reusedHits = new Map<string, Map<number, number>>();
    if (canReuseAll) {
      for (const lang of enabledLangs) {
        const lc = config.languages[lang]!;
        const covAbs = path.resolve(opts.repoRoot, lc.workingDirectory || ".", lc.coverageFile);
        if (!existsSync(covAbs)) {
          canReuseAll = false;
          break;
        }
        const covMtime = statSync(covAbs).mtimeMs;
        const srcMtime = getLatestSourceMtimeMs(
          opts.repoRoot,
          lc.workingDirectory,
          lc.sourceGlobs,
          config.exclude,
          opts.files,
        );
        if (srcMtime > 0 && covMtime < srcMtime) {
          canReuseAll = false;
          break;
        }
        const parsed = parseCoverageFile({
          filePath: lc.coverageFile,
          format: lc.coverageFormat,
          repoRoot: opts.repoRoot,
          workingDirectory: lc.workingDirectory,
          knownSourceFiles: opts.files ?? [],
        });
        if (!parsed) {
          canReuseAll = false;
          break;
        }
        for (const [k, v] of parsed.entries()) reusedHits.set(k, v);
      }
    }

    if (canReuseAll && reusedHits.size > 0) {
      baselineStatus = "green";
      reusedCoverage = true;
      baseline = {
        schemaVersion: 1,
        status: "green",
        perLanguage: Object.fromEntries(enabledLangs.map((l) => [l, { status: "green", patchCoveragePct: null }])),
        patchCoveragePct: null,
        lineHitsByFile: serializeCoverageLineMap(reusedHits),
      };
    } else {
      const baseRes = await runBaseline({
        repoRoot: opts.repoRoot,
        workDir: opts.workDir,
        config,
        plan,
        writeOutputs: false,
      });
      if (baseRes.status === "red") {
        const firstErr =
          Object.values(baseRes.perLanguage).find((s) => s.status === "red")?.detail ?? "Baseline failed";
        throw new StageError(
          `Baseline tests failed: ${firstErr}. Run \`local doctor --full\` or pass \`--skip-baseline\`.`,
          EXIT_CODES.CONFIG_OR_INPUT,
          "local",
          "baseline_red",
        );
      }
      baselineStatus = baseRes.status;
      baseline = baseRes;
    }
  }

  const prepareDir = path.join(opts.workDir, ARTIFACTS.prepare.dir);
  mkdirSync(prepareDir, { recursive: true });
  writeFileSync(path.join(prepareDir, "baseline.json"), `${JSON.stringify(baseline, null, 2)}\n`, "utf8");

  if (existsSync(opts.workDir)) {
    for (const ent of readdirSync(opts.workDir, { withFileTypes: true })) {
      if (ent.name === "final" || ent.name.startsWith("validate") || ent.name.startsWith("snapshot")) {
        rmSync(path.join(opts.workDir, ent.name), { recursive: true, force: true });
      }
    }
    for (const staleChat of ["proposed.json", "applied.json"]) {
      rmSync(path.join(opts.workDir, "chat", staleChat), { force: true });
    }
  }

  const manifest = await runDetect({
    repoRoot: opts.repoRoot,
    workDir: opts.workDir,
    config,
    diffSource: {
      kind: "local",
      scope,
      baseRef: baseRef ?? undefined,
      files: opts.files,
      symbols: opts.symbols,
      includeCovered: opts.includeCovered,
    },
    baseline,
    wasmDir: opts.wasmDir,
    writeOutputs: false,
  });

  const stagingDirRel = cleanRepoRelative(normalizeSlashes(config.local.stagingDir));
  mkdirSync(path.join(opts.repoRoot, stagingDirRel), { recursive: true });
  const workDirRel = cleanRepoRelative(normalizeSlashes(path.relative(opts.repoRoot, opts.workDir) || ".unit-agent"));

  const files = manifest.files.map((mf) => ({
    fileId: mf.fileId,
    path: cleanRepoRelative(normalizeSlashes(mf.path)),
    testPath: cleanRepoRelative(normalizeSlashes(mf.testPath)),
    stagedPath: cleanRepoRelative(path.posix.join(stagingDirRel, cleanRepoRelative(normalizeSlashes(mf.testPath)))),
    contextPath: cleanRepoRelative(
      path.posix.join(workDirRel, ARTIFACTS.prepare.dir, cleanRepoRelative(normalizeSlashes(mf.contextPath))),
    ),
    symbols: mf.symbols.map((s) => ({
      symbolId: s.symbolId,
      qualifiedName: s.qualifiedName,
      coveragePct: s.coveragePct,
      changedLines: s.changedLines.length,
    })),
  }));

  const summary = LocalDetectSummarySchema.parse({
    schemaVersion: 1,
    scope,
    baseRef,
    baseline: {
      status: baselineStatus,
      reusedCoverage,
    },
    files,
    skipped: manifest.skipped.map((s) => ({
      path: cleanRepoRelative(normalizeSlashes(s.path)),
      reason: s.reason,
    })),
    next:
      files.length > 0
        ? "Run local show --context <fileId>, write test drafts under stagedPath, then run local validate."
        : "No untested targets found for this scope.",
    truncated: false,
  });

  return { manifest, summary };
}
