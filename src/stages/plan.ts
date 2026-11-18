import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";

import { loadConfig } from "../config";
import {
  ARTIFACTS,
  PlanOutputSchema,
  ToolVersionsSchema,
  type LanguageKey,
  type LoggerLike,
  type PlanOutput,
  type ToolVersions,
  type UnitAgentConfig,
} from "../contracts";
import { detectFrameworkForLanguage } from "../core/context";
import { getDiffChangedRanges, resolveDiffRange, type PullRequestEventLike } from "../core/git";
import { detectLanguageFromPath } from "../core/parse";
import { cleanRepoRelative, normalizeSlashes } from "../core/paths";
import { buildLanguageToolVersions, resolveJavaBuildTool, resolveToolchainForLanguage } from "../languages/toolchains";
import { writeGitHubOutput, writeStageStatus } from "../telemetry";

export function matchLanguageSourceFiles(
  changedPaths: readonly string[],
  config: UnitAgentConfig,
): Map<LanguageKey, string[]> {
  const result = new Map<LanguageKey, string[]>();
  const excludeMatcher = picomatch(config.exclude, {
    dot: true,
    nocase: process.platform === "win32",
  });

  for (const lang of ["javascript", "python", "java"] as LanguageKey[]) {
    const langCfg = config.languages[lang];
    if (!langCfg || !langCfg.enabled) continue;
    const wd = cleanRepoRelative(normalizeSlashes(langCfg.workingDirectory));
    const fullGlobs = langCfg.sourceGlobs.map((g) => {
      const cleanG = cleanRepoRelative(normalizeSlashes(g));
      return wd && wd !== "." ? `${wd}/${cleanG}` : cleanG;
    });
    const matcher = picomatch(fullGlobs, {
      dot: true,
      nocase: process.platform === "win32",
    });

    const matched = changedPaths.filter((p) => detectLanguageFromPath(p) === lang && !excludeMatcher(p) && matcher(p));
    if (matched.length > 0) {
      result.set(lang, matched);
    }
  }

  return result;
}

export interface RunPlanOptions {
  repoRoot: string;
  workDir: string;
  configPath?: string;
  config?: UnitAgentConfig;
  eventPath?: string;
  eventPayload?: PullRequestEventLike | null;
  baseSha?: string;
  headSha?: string;
  changedPathsOverride?: readonly string[];
  logger?: LoggerLike;
  writeOutputs?: boolean;
}

export interface PlanStageResult {
  plan: PlanOutput;
  tools: ToolVersions;
  baseSha: string;
  headSha: string;
  matchedByLanguage: Record<string, string[]>;
}

export async function runPlan(opts: RunPlanOptions): Promise<PlanStageResult> {
  const config = opts.config ?? loadConfig(opts.repoRoot, opts.configPath).config;

  let eventPayload = opts.eventPayload ?? null;
  if (!eventPayload && (opts.eventPath || process.env.GITHUB_EVENT_PATH)) {
    const resolved = path.resolve(opts.eventPath ?? process.env.GITHUB_EVENT_PATH ?? "");
    eventPayload = JSON.parse(readFileSync(resolved, "utf8")) as PullRequestEventLike;
  }

  let baseSha = opts.baseSha ?? eventPayload?.pull_request?.base?.sha ?? "";
  let headSha = opts.headSha ?? eventPayload?.pull_request?.head?.sha ?? "";
  let changedPaths: string[];

  if (opts.changedPathsOverride) {
    changedPaths = [...opts.changedPathsOverride];
  } else {
    const range = await resolveDiffRange({
      repoRoot: opts.repoRoot,
      baseSha: opts.baseSha,
      headSha: opts.headSha,
      event: eventPayload,
    });
    baseSha = range.baseSha;
    headSha = range.headSha;
    const ranges = await getDiffChangedRanges({
      repoRoot: opts.repoRoot,
      baseSha: range.baseSha,
      headSha: range.headSha,
    });
    changedPaths = Object.keys(ranges);
  }

  const matchedMap = matchLanguageSourceFiles(changedPaths, config);
  const selectedLanguages: LanguageKey[] = [];
  const toolchains: PlanOutput["toolchains"] = {};
  const frameworks: PlanOutput["frameworks"] = {};
  const skipped: PlanOutput["skipped"] = [];
  const warnings: string[] = [];
  const toolVersionsLangs: ToolVersions["languages"] = {};
  const matchedByLanguage: Record<string, string[]> = {};

  for (const [lang, files] of matchedMap.entries()) {
    matchedByLanguage[lang] = files;
    const langCfg = config.languages[lang]!;
    const tc = resolveToolchainForLanguage({
      repoRoot: opts.repoRoot,
      language: lang,
      langConfig: langCfg,
    });
    if (tc.warning) warnings.push(`${lang}: ${tc.warning}`);

    const fw = detectFrameworkForLanguage({
      language: lang,
      langConfig: langCfg,
      repoRoot: opts.repoRoot,
    });

    const toolInfo = buildLanguageToolVersions({
      repoRoot: opts.repoRoot,
      config,
      language: lang,
    });

    if (lang === "java") {
      const javaCfg = config.languages.java!;
      const bt = resolveJavaBuildTool(opts.repoRoot, javaCfg);
      if (bt.ambiguous) {
        skipped.push({ language: lang, reason: "ambiguous_build_tool", found: bt.ambiguous });
        warnings.push(bt.ambiguous);
        continue;
      }
      frameworks.java = {
        detected: fw.unsupportedFramework?.name ?? fw.framework,
        supported: toolInfo.framework?.supported ?? true,
        buildTool: bt.buildTool,
      };
      toolchains.java = tc.entry;
    } else if (lang === "javascript") {
      frameworks.javascript = {
        detected: fw.unsupportedFramework?.name ?? fw.framework,
        supported: toolInfo.framework?.supported ?? true,
      };
      toolchains.node = tc.entry;
    } else if (lang === "python") {
      frameworks.python = {
        detected: fw.unsupportedFramework?.name ?? fw.framework,
        supported: toolInfo.framework?.supported ?? true,
      };
      toolchains.python = tc.entry;
    }

    if (toolInfo.framework && !toolInfo.framework.supported) {
      warnings.push(
        fw.unsupportedFramework?.reason
          ? `${lang}: ${fw.unsupportedFramework.reason}`
          : `${lang}: Unsupported test framework "${toolInfo.framework.name}".`,
      );
      skipped.push({
        language: lang,
        reason: "unsupported_framework",
        found: `${toolInfo.framework.name}@${toolInfo.framework.version ?? "unknown"}`,
      });
      continue;
    }

    if (!tc.supported) {
      skipped.push({
        language: lang,
        reason: "unsupported_tool_version",
        found: tc.entry.version,
      });
      continue;
    }

    selectedLanguages.push(lang);
    toolVersionsLangs[lang] = toolInfo;
  }

  const plan = PlanOutputSchema.parse({
    schemaVersion: 1,
    languages: selectedLanguages,
    toolchains,
    frameworks,
    skipped,
    warnings,
  });

  const tools = ToolVersionsSchema.parse({
    agentNode: process.version,
    languages: toolVersionsLangs,
    warnings,
  });

  const planFile = path.join(opts.workDir, ARTIFACTS.prepare.dir, "plan.json");
  mkdirSync(path.dirname(planFile), { recursive: true });
  writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  const toolsFile = path.join(opts.workDir, ARTIFACTS.prepare.dir, "tools.json");
  mkdirSync(path.dirname(toolsFile), { recursive: true });
  writeFileSync(toolsFile, `${JSON.stringify(tools, null, 2)}\n`, "utf8");

  writeStageStatus(opts.workDir, {
    stage: "prepare",
    status: "ok",
  });

  if (opts.writeOutputs !== false) {
    writeGitHubOutput({
      languages_json: JSON.stringify(plan.languages),
      run_js: String(plan.languages.includes("javascript")),
      run_python: String(plan.languages.includes("python")),
      run_java: String(plan.languages.includes("java")),
      node_version: plan.toolchains.node?.version ?? "22",
      python_version: plan.toolchains.python?.version ?? "3.12",
      java_version: plan.toolchains.java?.version ?? "21",
      java_distribution: plan.toolchains.java?.distribution ?? "temurin",
      base_sha: baseSha,
      head_sha: headSha,
      status: "ok",
    });
  }

  opts.logger?.info({ languages: plan.languages, skipped: plan.skipped }, "Plan complete");

  return {
    plan,
    tools,
    baseSha,
    headSha,
    matchedByLanguage,
  };
}
