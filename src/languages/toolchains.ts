import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type {
  JavaConfig,
  LanguageConfig,
  LanguageKey,
  LanguageToolVersions,
  ToolchainEntry,
  UnitAgentConfig,
} from "../contracts";
import { detectFrameworkForLanguage } from "../core/context";
import { cleanRepoRelative, normalizeSlashes } from "../core/paths";
import {
  JS_TOOLCHAIN_MISMATCH_PATTERNS,
  JEST_SUPPORT,
  NODE_SUPPORT,
  VITEST_SUPPORT,
  classifyVersionTier,
  extractMajorVersion,
} from "./javascript/compat";
import { JAVA_TOOLCHAIN_MISMATCH_PATTERNS, classifyJavaSupport, extractJavaMajor } from "./java/compat";
import { PYTHON_TOOLCHAIN_MISMATCH_PATTERNS, classifyPythonSupport, parseMajorMinor } from "./python/compat";

export interface DetectedToolchainResult {
  entry: ToolchainEntry;
  supported: boolean;
  warning?: string;
  tier: "tested" | "best-effort";
}

function withRunnerDefaultWarning(
  checkReason: string | undefined,
  source: ToolchainEntry["source"],
  runtimeLabel: string,
): string | undefined {
  if (checkReason) return checkReason;
  if (source === "runner-default") {
    return `No version configured or detected; using runner-default ${runtimeLabel}.`;
  }
  return undefined;
}

function stripLineComments(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((ln) => ln.replace(/(?:^|\s)#.*$/, "").trim())
    .filter(Boolean)
    .join("\n");
}

function readFirstExisting(paths: readonly string[]): { absPath: string; content: string } | null {
  for (const p of paths) {
    if (existsSync(p)) {
      return { absPath: p, content: readFileSync(p, "utf8") };
    }
  }
  return null;
}

function normalizeRepoRel(repoRoot: string, absPath: string): string {
  return cleanRepoRelative(normalizeSlashes(path.relative(repoRoot, absPath)));
}

function resolveNodeVersionSpec(raw: string): string {
  const clean = stripLineComments(raw);
  const clauses = clean
    .split(/[\s,|]+/)
    .map((c) => /(\d+(?:\.\d+)?)/.exec(c)?.[1])
    .filter((v): v is string => Boolean(v));
  if (clauses.length === 0) return "22";
  // Pick highest major across multi-clause ranges like ">=18 <23" or "18 || 20"
  clauses.sort((a, b) => Number.parseFloat(b) - Number.parseFloat(a));
  return clauses[0]!;
}

export function resolveJavaBuildTool(
  repoRoot: string,
  javaCfg: JavaConfig,
): { buildTool?: "maven" | "gradle"; ambiguous?: string } {
  const wdAbs = path.resolve(repoRoot, javaCfg.workingDirectory || ".");
  const hasPom = existsSync(path.join(wdAbs, "pom.xml"));
  const hasGradle = existsSync(path.join(wdAbs, "build.gradle")) || existsSync(path.join(wdAbs, "build.gradle.kts"));

  if (javaCfg.buildTool !== "auto") {
    return { buildTool: javaCfg.buildTool };
  }
  if (hasPom && hasGradle) {
    return {
      ambiguous: `Both pom.xml and build.gradle(.kts) found in "${javaCfg.workingDirectory}". Set languages.java.buildTool explicitly.`,
    };
  }
  if (hasGradle) return { buildTool: "gradle" };
  if (hasPom) return { buildTool: "maven" };
  return { buildTool: undefined };
}

export function resolveToolchainForLanguage(params: {
  repoRoot: string;
  language: LanguageKey;
  langConfig: LanguageConfig;
}): DetectedToolchainResult {
  const wdAbs = path.resolve(params.repoRoot, params.langConfig.workingDirectory || ".");

  if (params.language === "javascript") {
    let rawVersion: string | undefined;
    let source: ToolchainEntry["source"] = "runner-default";
    let fileRel: string | undefined;

    if (params.langConfig.toolchain) {
      rawVersion = params.langConfig.toolchain;
      source = "config";
    } else if (params.langConfig.toolchainFile) {
      const tf = path.resolve(params.repoRoot, params.langConfig.toolchainFile);
      if (existsSync(tf)) {
        rawVersion = resolveNodeVersionSpec(readFileSync(tf, "utf8"));
        source = "version-file";
        fileRel = params.langConfig.toolchainFile;
      }
    } else {
      const hit = readFirstExisting([
        path.join(wdAbs, ".nvmrc"),
        path.join(wdAbs, ".node-version"),
        path.join(params.repoRoot, ".nvmrc"),
        path.join(params.repoRoot, ".node-version"),
      ]);
      if (hit) {
        rawVersion = resolveNodeVersionSpec(hit.content);
        source = "version-file";
        fileRel = normalizeRepoRel(params.repoRoot, hit.absPath);
      } else {
        for (const pkgPath of [path.join(wdAbs, "package.json"), path.join(params.repoRoot, "package.json")]) {
          if (!existsSync(pkgPath)) continue;
          try {
            const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { engines?: { node?: string } };
            if (parsed.engines?.node) {
              rawVersion = resolveNodeVersionSpec(parsed.engines.node);
              source = "version-file";
              fileRel = normalizeRepoRel(params.repoRoot, pkgPath);
              break;
            }
          } catch {
            // ignore bad package.json
          }
        }
      }
    }

    const version = rawVersion ?? "22";
    const check = classifyVersionTier(version, NODE_SUPPORT);
    return {
      entry: { version, file: fileRel, source },
      supported: check.supported,
      tier: check.tier,
      warning: withRunnerDefaultWarning(check.reason, source, `Node ${version}`),
    };
  }

  if (params.language === "python") {
    let rawVersion: string | undefined;
    let source: ToolchainEntry["source"] = "runner-default";
    let fileRel: string | undefined;

    if (params.langConfig.toolchain) {
      rawVersion = params.langConfig.toolchain;
      source = "config";
    } else if (params.langConfig.toolchainFile) {
      const tf = path.resolve(params.repoRoot, params.langConfig.toolchainFile);
      if (existsSync(tf)) {
        const mm = parseMajorMinor(readFileSync(tf, "utf8"));
        rawVersion = mm ? `${mm.major}.${mm.minor}` : readFileSync(tf, "utf8").trim();
        source = "version-file";
        fileRel = params.langConfig.toolchainFile;
      }
    } else {
      const pv = readFirstExisting([
        path.join(wdAbs, ".python-version"),
        path.join(params.repoRoot, ".python-version"),
      ]);
      if (pv) {
        const cleanPv = stripLineComments(pv.content);
        const mm = parseMajorMinor(cleanPv);
        rawVersion = mm ? `${mm.major}.${mm.minor}` : undefined;
        source = "version-file";
        fileRel = normalizeRepoRel(params.repoRoot, pv.absPath);
      } else {
        for (const pypPath of [path.join(wdAbs, "pyproject.toml"), path.join(params.repoRoot, "pyproject.toml")]) {
          if (!existsSync(pypPath)) continue;
          const cleanToml = stripLineComments(readFileSync(pypPath, "utf8"));
          const m = /requires-python\s*=\s*["']([^"']+)["']/i.exec(cleanToml);
          if (m?.[1]) {
            const mm = parseMajorMinor(m[1]);
            if (mm) {
              rawVersion = `${mm.major}.${mm.minor}`;
              source = "version-file";
              fileRel = normalizeRepoRel(params.repoRoot, pypPath);
              break;
            }
          }
        }
      }
    }

    const version = rawVersion ?? "3.12";
    const check = classifyPythonSupport(version);
    return {
      entry: { version, file: fileRel, source },
      supported: check.supported,
      tier: check.tier,
      warning: withRunnerDefaultWarning(check.reason, source, `Python ${version}`),
    };
  }

  // Java
  const javaCfg = params.langConfig as JavaConfig;
  let rawVersion: string | undefined;
  let source: ToolchainEntry["source"] = "runner-default";
  let fileRel: string | undefined;

  if (javaCfg.toolchain) {
    rawVersion = String(extractJavaMajor(javaCfg.toolchain) ?? javaCfg.toolchain);
    source = "config";
  } else if (javaCfg.toolchainFile) {
    const tf = path.resolve(params.repoRoot, javaCfg.toolchainFile);
    if (existsSync(tf)) {
      rawVersion = String(extractJavaMajor(readFileSync(tf, "utf8")) ?? "21");
      source = "version-file";
      fileRel = javaCfg.toolchainFile;
    }
  } else {
    const jv = readFirstExisting([
      path.join(wdAbs, ".java-version"),
      path.join(wdAbs, ".sdkmanrc"),
      path.join(params.repoRoot, ".java-version"),
      path.join(params.repoRoot, ".sdkmanrc"),
    ]);
    if (jv) {
      const cleanContent = stripLineComments(jv.content);
      const m = jv.absPath.endsWith(".sdkmanrc") ? /java=([^\s#]+)/.exec(cleanContent)?.[1] : cleanContent.trim();
      const major = extractJavaMajor(m);
      if (major !== null) {
        rawVersion = String(major);
        source = "version-file";
        fileRel = normalizeRepoRel(params.repoRoot, jv.absPath);
      }
    } else {
      for (const pomPath of [path.join(wdAbs, "pom.xml"), path.join(params.repoRoot, "pom.xml")]) {
        if (!existsSync(pomPath)) continue;
        const cleanXml = readFileSync(pomPath, "utf8").replace(/<!--[\s\S]*?-->/g, "");
        const m = /<(?:maven\.compiler\.(?:release|source|target)|java\.version)>\s*([^<\s]+)\s*</.exec(cleanXml);
        const major = extractJavaMajor(m?.[1]);
        if (major !== null) {
          rawVersion = String(major);
          source = "version-file";
          fileRel = normalizeRepoRel(params.repoRoot, pomPath);
          break;
        }
      }
      if (!rawVersion) {
        for (const grPath of [
          path.join(wdAbs, "build.gradle"),
          path.join(wdAbs, "build.gradle.kts"),
          path.join(params.repoRoot, "build.gradle"),
          path.join(params.repoRoot, "build.gradle.kts"),
        ]) {
          if (!existsSync(grPath)) continue;
          const cleanGradle = readFileSync(grPath, "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/[^\r\n]*/g, "");
          const m = /(?:JavaLanguageVersion\.of\(\s*(\d+)\s*\)|sourceCompatibility\s*=?\s*['"]?([0-9.]+)['"]?)/.exec(
            cleanGradle,
          );
          const major = extractJavaMajor(m?.[1] ?? m?.[2]);
          if (major !== null) {
            rawVersion = String(major);
            source = "version-file";
            fileRel = normalizeRepoRel(params.repoRoot, grPath);
            break;
          }
        }
      }
    }
  }

  const version = rawVersion ?? "21";
  const check = classifyJavaSupport(version);
  return {
    entry: {
      version,
      file: fileRel,
      source,
      distribution: javaCfg.distribution ?? "temurin",
    },
    supported: check.supported,
    tier: check.tier,
    warning: withRunnerDefaultWarning(check.reason, source, `JDK ${version}`),
  };
}

export function buildLanguageToolVersions(params: {
  repoRoot: string;
  config: UnitAgentConfig;
  language: LanguageKey;
}): LanguageToolVersions {
  const langCfg = params.config.languages[params.language]!;
  const tc = resolveToolchainForLanguage({
    repoRoot: params.repoRoot,
    language: params.language,
    langConfig: langCfg,
  });
  const fw = detectFrameworkForLanguage({
    language: params.language,
    langConfig: langCfg,
    repoRoot: params.repoRoot,
  });

  let fwSupported = !fw.unsupportedFramework;
  if (fwSupported && params.language === "javascript") {
    const matrix = fw.framework === "jest" ? JEST_SUPPORT : VITEST_SUPPORT;
    if (fw.version) {
      fwSupported = classifyVersionTier(fw.version, matrix).supported;
    }
  } else if (fwSupported && params.language === "python" && fw.version) {
    const major = extractMajorVersion(fw.version);
    if (major !== null && major < 7) fwSupported = false;
  }

  return {
    runtime: {
      version: tc.entry.version ?? null,
      source: tc.entry.source,
      detail: tc.entry.file,
    },
    buildTool:
      params.language === "java"
        ? {
            version: resolveJavaBuildTool(params.repoRoot, langCfg as JavaConfig).buildTool ?? null,
            source: "detected",
          }
        : undefined,
    framework: {
      name: fw.unsupportedFramework?.name ?? fw.framework,
      version: fw.unsupportedFramework?.version ?? fw.version,
      supported: fwSupported,
    },
    tier: tc.tier,
  };
}

export function matchToolchainMismatch(
  logText: string,
  language?: LanguageKey,
): {
  reason: "toolchain_mismatch" | "unsupported_tool_version";
  language: LanguageKey;
  detail: string;
} | null {
  if (!language || language === "javascript") {
    for (const pat of JS_TOOLCHAIN_MISMATCH_PATTERNS) {
      const m = pat.exec(logText);
      if (m) {
        return { reason: "toolchain_mismatch", language: "javascript", detail: m[0] };
      }
    }
  }
  if (!language || language === "python") {
    for (const pat of PYTHON_TOOLCHAIN_MISMATCH_PATTERNS) {
      const m = pat.exec(logText);
      if (m) {
        return { reason: "toolchain_mismatch", language: "python", detail: m[0] };
      }
    }
  }
  if (!language || language === "java") {
    for (const pat of JAVA_TOOLCHAIN_MISMATCH_PATTERNS) {
      const m = pat.exec(logText);
      if (m) {
        const reason = /Minimum supported Gradle|invalid target release/i.test(m[0])
          ? "unsupported_tool_version"
          : "toolchain_mismatch";
        return { reason, language: "java", detail: m[0] };
      }
    }
  }
  return null;
}
