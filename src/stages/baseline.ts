import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadConfig, tokenizeCommand } from "../config";
import {
  ARTIFACTS,
  PlanOutputSchema,
  type JavaConfig,
  type LanguageKey,
  type LoggerLike,
  type PlanOutput,
  type UnitAgentConfig,
} from "../contracts";
import { computePatchCoverage, parseCoverageFile, type CoverageLineMap } from "../core/coverage";
import { runCommand } from "../exec/exec";
import { matchToolchainMismatch } from "../languages/toolchains";
import { sanitizeLogTail, writeGitHubOutput } from "../telemetry";
import { runJavaCommandWithWrapperHandling } from "./validate/runners/java/detect";

export interface BaselineLanguageState {
  status: "green" | "red" | "no_coverage";
  patchCoveragePct: number | null;
  detail?: string;
  mismatchReason?: "tool_missing" | "toolchain_mismatch" | "unsupported_tool_version" | "wrapper_unavailable";
}

export interface BaselineArtifact {
  schemaVersion: 1;
  status: "green" | "red" | "no_coverage";
  perLanguage: Record<string, BaselineLanguageState>;
  patchCoveragePct: number | null;
  lineHitsByFile: Record<string, Array<[number, number]>>;
}

export interface RunBaselineOptions {
  repoRoot: string;
  workDir: string;
  configPath?: string;
  config?: UnitAgentConfig;
  planPath?: string;
  plan?: PlanOutput;
  changedLinesByFile?: ReadonlyMap<string, ReadonlySet<number>>;
  knownSourceFiles?: readonly string[];
  logger?: LoggerLike;
  writeOutputs?: boolean;
}

export function serializeCoverageLineMap(map: CoverageLineMap): Record<string, Array<[number, number]>> {
  const obj: Record<string, Array<[number, number]>> = {};
  for (const [filePath, lineMap] of map.entries()) {
    obj[filePath] = [...lineMap.entries()].sort((a, b) => a[0] - b[0]);
  }
  return obj;
}

export function deserializeCoverageLineMap(obj: Record<string, Array<[number, number]>>): CoverageLineMap {
  const map: CoverageLineMap = new Map();
  for (const [filePath, entries] of Object.entries(obj)) {
    map.set(filePath, new Map(entries));
  }
  return map;
}

export async function runBaseline(opts: RunBaselineOptions): Promise<BaselineArtifact> {
  const config = opts.config ?? loadConfig(opts.repoRoot, opts.configPath).config;

  let plan = opts.plan;
  if (!plan) {
    const p = opts.planPath ?? path.join(opts.workDir, ARTIFACTS.prepare.dir, "plan.json");
    plan = existsSync(p)
      ? PlanOutputSchema.parse(JSON.parse(readFileSync(p, "utf8")))
      : PlanOutputSchema.parse({
          schemaVersion: 1,
          languages: (["javascript", "python", "java"] as LanguageKey[]).filter((l) => config.languages[l]?.enabled),
          toolchains: {},
          frameworks: {},
          skipped: [],
          warnings: [],
        });
  }

  const perLanguage: Record<string, BaselineLanguageState> = {};
  const mergedCoverage: CoverageLineMap = new Map();

  for (const lang of plan.languages) {
    const langCfg = config.languages[lang];
    if (!langCfg || !langCfg.enabled) continue;

    if (config.baseline.mode === "run") {
      const cwd = path.resolve(opts.repoRoot, langCfg.workingDirectory || ".");
      const { file, args } = tokenizeCommand(langCfg.testCommand);
      let res;
      let wrapperUnavailable: { host?: string; detail: string } | undefined;
      if (lang === "java") {
        const handled = await runJavaCommandWithWrapperHandling({
          repoRoot: opts.repoRoot,
          workDir: opts.workDir,
          config,
          javaConfig: langCfg as JavaConfig,
          cwd,
          file,
          args,
          timeoutMs: config.baseline.timeoutMinutes * 60_000,
          killChildrenOnExit: true,
          logger: opts.logger,
        });
        res = handled.execRes;
        wrapperUnavailable = handled.wrapperUnavailable;
      } else {
        res = await runCommand(file, args, {
          cwd,
          timeoutMs: config.baseline.timeoutMinutes * 60_000,
          config,
          killChildrenOnExit: true,
        });
      }

      if (res.timedOut) {
        const msg = `baseline exceeded ${config.baseline.timeoutMinutes} minutes; set baseline.mode: skip or a faster testCommand`;
        perLanguage[lang] = {
          status: "no_coverage",
          patchCoveragePct: null,
          detail: msg,
        };
        opts.logger?.warn({ language: lang, timeoutMinutes: config.baseline.timeoutMinutes }, msg);
        continue;
      }

      if (wrapperUnavailable) {
        perLanguage[lang] = {
          status: "red",
          patchCoveragePct: null,
          detail: wrapperUnavailable.detail,
          mismatchReason: "wrapper_unavailable",
        };
        opts.logger?.warn({ language: lang, host: wrapperUnavailable.host }, wrapperUnavailable.detail);
        continue;
      }

      if (res.spawnError) {
        perLanguage[lang] = {
          status: "red",
          patchCoveragePct: null,
          detail: `Baseline command could not be launched: ${res.spawnError}`,
          mismatchReason: "tool_missing",
        };
        opts.logger?.warn({ language: lang, spawnError: res.spawnError }, "Baseline command could not be launched");
        continue;
      }

      if (res.exitCode !== 0) {
        const combined = `${res.stdout}\n${res.stderr}`;
        const mismatch = matchToolchainMismatch(combined, lang);
        const tail = sanitizeLogTail(combined, { repoRoot: opts.repoRoot }, 40);
        const detail = mismatch
          ? `${mismatch.detail} — Incompatible toolchain/build-tool version. Select a compatible runtime toolchain or upgrade the wrapper. (${tail})`
          : tail;
        perLanguage[lang] = {
          status: "red",
          patchCoveragePct: null,
          detail,
          ...(mismatch ? { mismatchReason: mismatch.reason } : {}),
        };
        opts.logger?.warn(
          { language: lang, exitCode: res.exitCode, mismatchReason: mismatch?.reason },
          mismatch ? `Baseline ${mismatch.reason}: ${mismatch.detail}` : "Baseline tests failed (red)",
        );
        continue;
      }
    }

    const parsedCov = parseCoverageFile({
      filePath: langCfg.coverageFile,
      format: langCfg.coverageFormat,
      repoRoot: opts.repoRoot,
      workingDirectory: langCfg.workingDirectory,
      knownSourceFiles: opts.knownSourceFiles,
    });

    if (!parsedCov || parsedCov.size === 0) {
      perLanguage[lang] = {
        status: "no_coverage",
        patchCoveragePct: null,
        detail:
          config.baseline.mode === "skip"
            ? "baseline skipped; no cached coverage found"
            : "coverage file missing or empty",
      };
      continue;
    }

    for (const [filePath, lineHits] of parsedCov.entries()) {
      mergedCoverage.set(filePath, lineHits);
    }

    const langPatch = opts.changedLinesByFile
      ? computePatchCoverage({ changedLinesByFile: opts.changedLinesByFile, coverageMap: parsedCov })
      : { patchCoveragePct: null };

    perLanguage[lang] = {
      status: "green",
      patchCoveragePct: langPatch.patchCoveragePct,
    };
  }

  const langStates = Object.values(perLanguage);
  const overallStatus: BaselineArtifact["status"] = langStates.some((s) => s.status === "red")
    ? "red"
    : langStates.some((s) => s.status === "green")
      ? "green"
      : "no_coverage";

  const overallPatch =
    opts.changedLinesByFile && mergedCoverage.size > 0
      ? computePatchCoverage({ changedLinesByFile: opts.changedLinesByFile, coverageMap: mergedCoverage })
          .patchCoveragePct
      : null;

  const artifact: BaselineArtifact = {
    schemaVersion: 1,
    status: overallStatus,
    perLanguage,
    patchCoveragePct: overallPatch,
    lineHitsByFile: serializeCoverageLineMap(mergedCoverage),
  };

  const outPath = path.join(opts.workDir, ARTIFACTS.prepare.dir, "baseline.json");
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  if (opts.writeOutputs !== false) {
    writeGitHubOutput({
      baseline_status: artifact.status,
      status: "ok",
    });
  }

  return artifact;
}
