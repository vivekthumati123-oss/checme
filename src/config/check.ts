import { existsSync } from "node:fs";
import path from "node:path";

import type { LanguageKey, UnitAgentConfig } from "../contracts";
import { parseArgvTokens } from "./argv";
import { loadConfig } from "./loader";
import { renderTestPathPattern } from "./templates";

export interface ConfigCheckFinding {
  level: "error" | "warning" | "info";
  path: string;
  message: string;
}

export interface ConfigCheckResult {
  ok: boolean;
  configPath: string;
  findings: ConfigCheckFinding[];
  warnings: string[];
  errors: string[];
  config?: UnitAgentConfig;
  summary?: {
    mode: "report" | "propose";
    enabledLanguages: LanguageKey[];
    sampleTestPaths: Record<string, string>;
    workspace: "copy" | "inplace";
    offlineStrategy: "none" | "unshare";
  };
}

export function runConfigCheck(repoRoot: string, explicitPath?: string): ConfigCheckResult {
  let loaded;
  try {
    loaded = loadConfig(repoRoot, explicitPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const cfgPath = explicitPath ?? ".unit-agent.yml";
    return {
      ok: false,
      configPath: cfgPath,
      findings: [{ level: "error", path: cfgPath, message: msg }],
      warnings: [],
      errors: [msg],
    };
  }

  const { config, configPath, warnings } = loaded;
  const findings: ConfigCheckFinding[] = [];
  const errors: string[] = [];

  for (const w of warnings) {
    findings.push({ level: "warning", path: "languages", message: w });
  }

  const enabledLanguages: LanguageKey[] = [];
  const sampleTestPaths: Record<string, string> = {};

  for (const lang of ["javascript", "python", "java"] as LanguageKey[]) {
    const lc = config.languages[lang];
    if (!lc || !lc.enabled) continue;
    enabledLanguages.push(lang);

    const workDirAbs = path.resolve(repoRoot, lc.workingDirectory);
    if (!existsSync(workDirAbs)) {
      const msg = `languages.${lang}.workingDirectory "${lc.workingDirectory}" does not exist on disk.`;
      findings.push({ level: "warning", path: `languages.${lang}.workingDirectory`, message: msg });
    }

    if (lc.toolchainFile) {
      const tfAbs = path.resolve(repoRoot, lc.toolchainFile);
      if (!existsSync(tfAbs)) {
        findings.push({
          level: "warning",
          path: `languages.${lang}.toolchainFile`,
          message: `toolchainFile "${lc.toolchainFile}" was not found under repo root.`,
        });
      }
    }

    // Double-check command tokenization
    for (const [field, cmd] of [
      ["installCommand", lc.installCommand],
      ["testCommand", lc.testCommand],
      ["formatCommand", lc.formatCommand],
      ["lintCommand", lc.lintCommand],
    ] as const) {
      if (!cmd) continue;
      try {
        parseArgvTokens(cmd);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`languages.${lang}.${field}: ${msg}`);
        findings.push({ level: "error", path: `languages.${lang}.${field}`, message: msg });
      }
    }

    // Preview sample resolved test path
    const sampleSource =
      lang === "java"
        ? "src/main/java/com/acme/SampleService.java"
        : lang === "python"
          ? "src/pkg/sample.py"
          : "src/sample.ts";
    sampleTestPaths[lang] = renderTestPathPattern({
      language: lang,
      sourcePath: sampleSource,
      pattern: lc.testPathPatterns[0] ?? "",
      className: lang === "java" ? "SampleService" : undefined,
      packageName: lang === "java" ? "com.acme" : undefined,
      generatedSuffix: lc.generatedSuffix,
    });
  }

  // Warn if gradle markers exist while offline.strategy is unshare and java.buildTool is auto
  if (
    config.offline.strategy === "unshare" &&
    config.languages.java?.enabled &&
    config.languages.java.buildTool === "auto"
  ) {
    const javaDir = path.resolve(repoRoot, config.languages.java.workingDirectory);
    if (existsSync(path.join(javaDir, "build.gradle")) || existsSync(path.join(javaDir, "build.gradle.kts"))) {
      const msg = "offline.strategy 'unshare' cannot be used when buildTool 'auto' resolves to Gradle.";
      errors.push(msg);
      findings.push({ level: "error", path: "offline.strategy", message: msg });
    }
  }

  return {
    ok: errors.length === 0,
    configPath: path.relative(repoRoot, configPath).replace(/\\/g, "/") || configPath,
    findings,
    warnings: findings.filter((f) => f.level === "warning").map((f) => f.message),
    errors,
    config,
    summary: {
      mode: config.mode,
      enabledLanguages,
      sampleTestPaths,
      workspace: config.validate.workspace,
      offlineStrategy: config.offline.strategy,
    },
  };
}
