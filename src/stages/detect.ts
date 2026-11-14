import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";

import { loadConfig, resolveTestPathForSource } from "../config";
import {
  ARTIFACTS,
  EXIT_CODES,
  FileContextSchema,
  ManifestSchema,
  StageError,
  type DiffSource,
  type LanguageKey,
  type LoggerLike,
  type Manifest,
  type ManifestFile,
  type UnitAgentConfig,
} from "../contracts";
import { buildFileContextPacket, checkNeverSend, makeFileId, sha256Hex } from "../core/context";
import {
  computePatchCoverage,
  mapSymbolsToCoverage,
  parseCoverageFile,
  type CoverageLineMap,
  type MappedSymbolCoverage,
} from "../core/coverage";
import { getDiffChangedRanges, getLocalGitDiff } from "../core/git";
import { detectLanguageFromPath, parseSourceFile, type FileParseResult } from "../core/parse";
import { cleanRepoRelative, normalizeSlashes, toRepoPath } from "../core/paths";
import { rankAndSelectSymbols, type CandidateSymbolInput } from "../core/rank";
import { runCommand } from "../exec/exec";
import { writeGitHubOutput, writeStageStatus } from "../telemetry";
import { deserializeCoverageLineMap, type BaselineArtifact } from "./baseline";

const MAX_SOURCE_BYTES = 512 * 1024;

export interface RunDetectOptions {
  repoRoot: string;
  workDir: string;
  configPath?: string;
  config?: UnitAgentConfig;
  diffSource: DiffSource;
  runId?: string;
  repoFullName?: string;
  prNumber?: number;
  baseSha?: string;
  headSha?: string;
  baseline?: BaselineArtifact | null;
  wasmDir?: string;
  logger?: LoggerLike;
  writeOutputs?: boolean;
}

async function listUntrackedRepoFiles(repoRoot: string): Promise<string[]> {
  const res = await runCommand("git", ["ls-files", "--others", "--exclude-standard"], { cwd: repoRoot });
  if (res.exitCode !== 0) return [];
  return res.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => toRepoPath(p, repoRoot));
}

async function listTrackedRepoFiles(repoRoot: string): Promise<string[]> {
  const res = await runCommand("git", ["ls-files"], { cwd: repoRoot });
  if (res.exitCode !== 0) return [];
  return res.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => toRepoPath(p, repoRoot));
}

async function resolveChangedLinesFromSource(
  repoRoot: string,
  diffSource: DiffSource,
): Promise<{
  changedLinesByFile: Map<string, Set<number>>;
  includeAllLines: boolean;
  baseSha: string;
  headSha: string;
}> {
  const changedLinesByFile = new Map<string, Set<number>>();

  if (diffSource.kind === "git-range") {
    const raw = await getDiffChangedRanges({
      repoRoot,
      baseSha: diffSource.base,
      headSha: diffSource.head,
    });
    for (const [p, lines] of Object.entries(raw)) {
      changedLinesByFile.set(p, new Set(lines));
    }
    return { changedLinesByFile, includeAllLines: false, baseSha: diffSource.base, headSha: diffSource.head };
  }

  const headRes = await runCommand("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  const headSha = headRes.exitCode === 0 ? headRes.stdout.trim() : "local-head";

  if (diffSource.scope === "files") {
    const globs = (diffSource.files ?? []).map((g) => cleanRepoRelative(normalizeSlashes(g)));
    const tracked = await listTrackedRepoFiles(repoRoot);
    const untracked = await listUntrackedRepoFiles(repoRoot);
    const all = [...new Set([...tracked, ...untracked])];
    const matcher = picomatch(globs, { dot: true, nocase: process.platform === "win32" });
    for (const f of all) {
      if (matcher(f) || globs.includes(f)) {
        changedLinesByFile.set(f, new Set());
      }
    }
    return { changedLinesByFile, includeAllLines: true, baseSha: diffSource.baseRef ?? headSha, headSha };
  }

  let gitArgs: string[];
  let includeUntracked = false;
  let resolvedBaseRef = diffSource.baseRef;
  if (diffSource.scope === "staged") {
    gitArgs = ["--cached"];
  } else if (diffSource.scope === "branch") {
    if (!resolvedBaseRef) {
      const sym = await runCommand("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
        cwd: repoRoot,
      });
      if (sym.exitCode === 0 && sym.stdout.trim()) {
        resolvedBaseRef = sym.stdout.trim();
      } else {
        const hasMain = await runCommand("git", ["rev-parse", "--verify", "main"], { cwd: repoRoot });
        if (hasMain.exitCode === 0) {
          resolvedBaseRef = "main";
        } else {
          const hasMaster = await runCommand("git", ["rev-parse", "--verify", "master"], { cwd: repoRoot });
          resolvedBaseRef = hasMaster.exitCode === 0 ? "master" : "HEAD";
        }
      }
    }
    const mbRes = await runCommand("git", ["merge-base", resolvedBaseRef, "HEAD"], { cwd: repoRoot });
    const mergeTarget = mbRes.exitCode === 0 && mbRes.stdout.trim() ? mbRes.stdout.trim() : resolvedBaseRef;
    gitArgs = [mergeTarget];
    includeUntracked = true;
  } else {
    // worktree = staged + unstaged relative to HEAD plus untracked files
    gitArgs = ["HEAD"];
    includeUntracked = true;
  }

  const diffMap = await getLocalGitDiff({ repoRoot, gitArgs });
  for (const [p, lines] of Object.entries(diffMap)) {
    changedLinesByFile.set(p, new Set(lines));
  }

  if (includeUntracked) {
    const untracked = await listUntrackedRepoFiles(repoRoot);
    for (const rel of untracked) {
      if (changedLinesByFile.has(rel)) continue;
      const abs = path.join(repoRoot, rel);
      if (!existsSync(abs)) continue;
      const lineCount = readFileSync(abs, "utf8").split(/\r?\n/).length;
      const lineSet = new Set<number>();
      for (let ln = 1; ln <= lineCount; ln += 1) lineSet.add(ln);
      changedLinesByFile.set(rel, lineSet);
    }
  }

  return { changedLinesByFile, includeAllLines: false, baseSha: resolvedBaseRef ?? headSha, headSha };
}

function matchConfiguredLanguage(repoRelPath: string, config: UnitAgentConfig): LanguageKey | null {
  const detected = detectLanguageFromPath(repoRelPath);
  if (!detected) return null;
  const langCfg = config.languages[detected];
  if (!langCfg || !langCfg.enabled) return null;

  const wd = cleanRepoRelative(normalizeSlashes(langCfg.workingDirectory));
  const globs = langCfg.sourceGlobs.map((g) => {
    const cg = cleanRepoRelative(normalizeSlashes(g));
    return wd && wd !== "." ? `${wd}/${cg}` : cg;
  });
  const matcher = picomatch(globs, { dot: true, nocase: process.platform === "win32" });
  return matcher(repoRelPath) ? detected : null;
}

export async function runDetect(opts: RunDetectOptions): Promise<Manifest> {
  const config = opts.config ?? loadConfig(opts.repoRoot, opts.configPath).config;
  const resolved = await resolveChangedLinesFromSource(opts.repoRoot, opts.diffSource);

  // Load baseline state if available
  let baselineArtifact = opts.baseline ?? null;
  if (!baselineArtifact) {
    const baseJsonPath = path.join(opts.workDir, ARTIFACTS.prepare.dir, "baseline.json");
    if (existsSync(baseJsonPath)) {
      baselineArtifact = JSON.parse(readFileSync(baseJsonPath, "utf8")) as BaselineArtifact;
    }
  }

  const excludeMatcher = picomatch(config.exclude, {
    dot: true,
    nocase: process.platform === "win32",
  });

  const knownSourceFiles = [...resolved.changedLinesByFile.keys()];
  const coverageMap: CoverageLineMap = baselineArtifact
    ? deserializeCoverageLineMap(baselineArtifact.lineHitsByFile)
    : new Map();

  // Also attempt reading configured coverage files on disk when baseline wasn't explicitly skipped/provided
  if (coverageMap.size === 0 && !opts.baseline) {
    for (const lang of ["javascript", "python", "java"] as LanguageKey[]) {
      const langCfg = config.languages[lang];
      if (!langCfg || !langCfg.enabled) continue;
      const cov = parseCoverageFile({
        filePath: langCfg.coverageFile,
        format: langCfg.coverageFormat,
        repoRoot: opts.repoRoot,
        workingDirectory: langCfg.workingDirectory,
        knownSourceFiles,
      });
      if (cov) {
        for (const [k, v] of cov.entries()) coverageMap.set(k, v);
      }
    }
  }

  const skipped: Manifest["skipped"] = [];
  const warnings: string[] = [];
  const allCandidates: CandidateSymbolInput[] = [];
  const parsedByPath = new Map<
    string,
    {
      language: LanguageKey;
      content: string;
      sha256: string;
      testPath: string;
      parsed: FileParseResult;
    }
  >();

  for (const [repoRelPath, changedLineSet] of resolved.changedLinesByFile.entries()) {
    if (excludeMatcher(repoRelPath)) continue;

    const language = matchConfiguredLanguage(repoRelPath, config);
    if (!language) continue;

    if (baselineArtifact?.perLanguage[language]?.status === "red" && opts.diffSource.kind === "git-range") {
      skipped.push({ path: repoRelPath, reason: "baseline_red", detail: `Baseline tests failed for ${language}.` });
      continue;
    }

    const absPath = path.join(opts.repoRoot, repoRelPath);
    if (!existsSync(absPath)) continue;

    const stat = statSync(absPath);
    if (!stat.isFile()) continue;
    if (stat.size > MAX_SOURCE_BYTES) {
      skipped.push({ path: repoRelPath, reason: "too_large", detail: `Size ${stat.size} bytes exceeds 512 KB.` });
      continue;
    }

    const content = readFileSync(absPath, "utf8");
    const ns = checkNeverSend(repoRelPath, content, config.privacy.neverSend);
    if (ns.blocked) {
      skipped.push({ path: repoRelPath, reason: ns.reason, detail: ns.detail });
      continue;
    }

    const parsed = await parseSourceFile({
      filePath: repoRelPath,
      content,
      language,
      minExecutableLines: config.limits.minExecutableLines,
      wasmDir: opts.wasmDir,
    });

    if (parsed.isTestFile || parsed.isGeneratedFile) continue;
    if (parsed.tooBroken) {
      skipped.push({ path: repoRelPath, reason: "parse_errors", detail: "AST error threshold exceeded." });
      continue;
    }
    if (parsed.eligibleSymbols.length === 0) {
      skipped.push({ path: repoRelPath, reason: "no_untested_symbols", detail: "No eligible exported symbols." });
      continue;
    }

    const langCfg = config.languages[language]!;
    const testPathRes = resolveTestPathForSource({
      repoRoot: opts.repoRoot,
      language,
      sourcePath: repoRelPath,
      testPathPatterns: langCfg.testPathPatterns,
      className: parsed.primaryClassName,
      packageName: parsed.packageName,
      generatedSuffix: langCfg.generatedSuffix,
    });

    if (testPathRes.skipReason === "already_has_agent_tests") {
      skipped.push({
        path: repoRelPath,
        reason: "already_has_agent_tests",
        detail: `Existing test "${testPathRes.testPath}" is not unit-agent generated.`,
      });
      continue;
    }

    const effectiveChangedLines = resolved.includeAllLines
      ? new Set<number>(Array.from({ length: content.split(/\r?\n/).length }, (_, i) => i + 1))
      : changedLineSet;

    const lineCov = coverageMap.get(repoRelPath);
    const mappedAll = mapSymbolsToCoverage({
      symbols: parsed.eligibleSymbols,
      changedLines: effectiveChangedLines,
      lineCoverage: lineCov,
    });

    const includeCovered = opts.diffSource.kind === "local" && Boolean(opts.diffSource.includeCovered);
    const symbolFilter = opts.diffSource.kind === "local" ? opts.diffSource.symbols : undefined;

    const filtered: MappedSymbolCoverage[] = mappedAll.filter((m) => {
      if (symbolFilter && symbolFilter.length > 0) {
        const matchesSymbol = symbolFilter.some((sf) => {
          if (sf === m.symbol.symbolId || sf === m.symbol.qualifiedName) return true;
          if (sf.endsWith(".*")) {
            const prefix = sf.slice(0, -1);
            return m.symbol.qualifiedName.startsWith(prefix);
          }
          return false;
        });
        if (!matchesSymbol) return false;
      }
      if (!resolved.includeAllLines && m.changedLines.length === 0) {
        return false;
      }
      if (!includeCovered && !m.estimated && m.coveragePct >= config.targets.symbolCoverageThreshold) {
        return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      skipped.push({
        path: repoRelPath,
        reason: "no_untested_symbols",
        detail: "Changed symbols either had zero diff overlap or met symbolCoverageThreshold.",
      });
      continue;
    }

    parsedByPath.set(repoRelPath, {
      language,
      content,
      sha256: sha256Hex(content),
      testPath: testPathRes.testPath,
      parsed,
    });

    for (const item of filtered) {
      allCandidates.push({
        filePath: repoRelPath,
        language,
        mapped: item,
      });
    }
  }

  const ranked = rankAndSelectSymbols({
    candidates: allCandidates,
    maxFilesPerPr: config.limits.maxFilesPerPr,
    maxSymbolsPerPr: config.limits.maxSymbolsPerPr,
  });

  for (const s of ranked.skipped) {
    skipped.push({ path: s.path, reason: s.reason, detail: s.detail });
  }

  const prepareDir = path.join(opts.workDir, ARTIFACTS.prepare.dir);
  const contextsDir = path.join(prepareDir, "contexts");
  mkdirSync(contextsDir, { recursive: true });

  const manifestFiles: ManifestFile[] = [];

  for (const group of ranked.selectedFiles) {
    const info = parsedByPath.get(group.filePath);
    if (!info) continue;

    const fileId = makeFileId(group.filePath);
    const contextRelPath = normalizeSlashes(path.posix.join("contexts", `${fileId}.json`));

    const ctxPacket = FileContextSchema.parse(
      await buildFileContextPacket({
        repoRoot: opts.repoRoot,
        config,
        fileId,
        language: info.language,
        sourcePath: group.filePath,
        testPath: info.testPath,
        sourceContent: info.content,
        symbols: group.symbols,
        allParsedSymbols: info.parsed.allSymbols,
        imports: info.parsed.imports,
        packageName: info.parsed.packageName,
        primaryClassName: info.parsed.primaryClassName,
      }),
    );

    writeFileSync(path.join(prepareDir, contextRelPath), `${JSON.stringify(ctxPacket, null, 2)}\n`, "utf8");

    const javaClassName = info.language === "java" ? path.posix.parse(info.testPath).name : undefined;

    manifestFiles.push({
      fileId,
      language: info.language,
      path: group.filePath,
      testPath: info.testPath,
      importHint: ctxPacket.conventions.importHint,
      contextPath: contextRelPath,
      sourceSha256: info.sha256,
      testClassName: javaClassName,
      symbols: group.symbols,
    });
  }

  const patchCov =
    coverageMap.size > 0
      ? computePatchCoverage({ changedLinesByFile: resolved.changedLinesByFile, coverageMap }).patchCoveragePct
      : null;

  const perLanguageBaseline: Manifest["baseline"]["perLanguage"] = baselineArtifact
    ? Object.fromEntries(
        Object.entries(baselineArtifact.perLanguage).map(([k, v]) => [
          k,
          { status: v.status, patchCoveragePct: v.patchCoveragePct },
        ]),
      )
    : {};

  const baselineStatus: Manifest["baseline"]["status"] =
    baselineArtifact?.status ?? (coverageMap.size > 0 ? "green" : "no_coverage");

  const manifest = ManifestSchema.parse({
    schemaVersion: 1,
    runId: opts.runId ?? process.env.GITHUB_RUN_ID ?? "local-run",
    repo: opts.repoFullName ?? process.env.GITHUB_REPOSITORY ?? "local/repo",
    pr: opts.prNumber ?? 0,
    baseSha: opts.baseSha ?? resolved.baseSha,
    headSha: opts.headSha ?? resolved.headSha,
    createdAt: new Date().toISOString(),
    baseline: {
      status: baselineStatus,
      perLanguage: perLanguageBaseline,
      patchCoveragePct: baselineArtifact?.patchCoveragePct ?? patchCov,
    },
    files: manifestFiles,
    warnings,
    skipped,
  });

  const manifestFile = path.join(opts.workDir, ARTIFACTS.prepare.dir, "manifest.json");
  mkdirSync(path.dirname(manifestFile), { recursive: true });
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  writeStageStatus(opts.workDir, {
    stage: "prepare",
    status: manifest.files.length > 0 ? "ok" : "skipped",
    reason: manifest.files.length > 0 ? "targets_detected" : "no_targets",
  });

  if (opts.writeOutputs !== false) {
    writeGitHubOutput({
      target_count: manifest.files.length,
      has_targets: String(manifest.files.length > 0),
      status: manifest.files.length > 0 ? "ok" : "skipped",
    });
  }

  opts.logger?.info({ targetFiles: manifest.files.length, skipped: manifest.skipped.length }, "Detect stage complete");

  return manifest;
}

export function loadManifest(workDir: string, explicitPath?: string): Manifest {
  const filePath = explicitPath ?? path.join(workDir, ARTIFACTS.prepare.dir, "manifest.json");
  if (!existsSync(filePath)) {
    throw new StageError(
      `Manifest file not found: "${filePath}"`,
      EXIT_CODES.CONFIG_OR_INPUT,
      "prepare",
      "missing_manifest",
    );
  }
  return ManifestSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
}
