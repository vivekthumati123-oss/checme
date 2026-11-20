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

function compareVerTuple(a: readonly [number, number], b: readonly [number, number]): number {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1];
}

function parseVersionTuple(raw: string): [number, number] | null {
  const m = /(\d+)(?:\.(\d+))?/.exec(raw);
  if (!m?.[1]) return null;
  const major = Number.parseInt(m[1], 10);
  const minor = m[2] ? Number.parseInt(m[2], 10) : 0;
  return Number.isFinite(major) && Number.isFinite(minor) ? [major, minor] : null;
}

function satisfiesRangeClause(candidate: readonly [number, number], rawClause: string): boolean {
  const tokens = rawClause
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (tokens.length === 0) return false;
  for (const token of tokens) {
    const m = /^(>=|<=|!=|==|>|<|\^|~|=)?v?(\d+)(?:\.(\d+))?/.exec(token.replace(/\.x|\.\*/gi, ""));
    if (!m?.[2]) continue;
    const op = m[1] ?? "=";
    const major = Number.parseInt(m[2], 10);
    const minor = m[3] ? Number.parseInt(m[3], 10) : 0;
    const target: [number, number] = [major, minor];
    const cmp = compareVerTuple(candidate, target);
    if (op === ">=" && cmp < 0) return false;
    else if (op === ">" && cmp <= 0) return false;
    else if (op === "<=" && cmp > 0) return false;
    else if (op === "<" && cmp >= 0) return false;
    else if (op === "!=" && cmp === 0) return false;
    else if ((op === "==" || op === "=") && (m[3] ? cmp !== 0 : candidate[0] !== major)) return false;
    else if (op === "^" && (cmp < 0 || candidate[0] !== major)) return false;
    else if (op === "~" && (cmp < 0 || candidate[0] !== major || (m[3] !== undefined && candidate[1] !== minor))) {
      return false;
    }
  }
  return true;
}

function selectVersionFromRange(
  rawSpec: string,
  candidates: ReadonlyArray<readonly [number, number]>,
  format: (t: readonly [number, number]) => string,
): string | undefined {
  const clean = stripLineComments(rawSpec);
  const orClauses = clean
    .split(/\|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (orClauses.length === 0) return undefined;
  const sorted = [...candidates].sort((a, b) => compareVerTuple(b, a));
  for (const cand of sorted) {
    if (orClauses.some((clause) => satisfiesRangeClause(cand, clause))) {
      return format(cand);
    }
  }
  return undefined;
}

const NODE_CANDIDATES: ReadonlyArray<readonly [number, number]> = [
  [24, 0],
  [22, 0],
  [20, 0],
  [18, 0],
  [16, 0],
];

const PYTHON_CANDIDATES: ReadonlyArray<readonly [number, number]> = [
  [3, 13],
  [3, 12],
  [3, 11],
  [3, 10],
  [3, 9],
  [3, 8],
];

function resolveNodeVersionSpec(raw: string): string {
  const clean = stripLineComments(raw);
  if (!/[<>!=^~|]/.test(clean)) {
    const exact = /(\d+(?:\.\d+)?)/.exec(clean)?.[1];
    if (exact) return exact;
  }
  return (
    selectVersionFromRange(clean, NODE_CANDIDATES, (t) => String(t[0])) ??
    (() => {
      const m = parseVersionTuple(clean);
      return m ? String(m[0]) : "22";
    })()
  );
}

function resolvePythonVersionSpec(raw: string): string | undefined {
  const clean = stripLineComments(raw);
  if (!/[<>!=^~|]/.test(clean)) {
    const mm = parseMajorMinor(clean);
    return mm ? `${mm.major}.${mm.minor}` : undefined;
  }
  const fromRange = selectVersionFromRange(clean, PYTHON_CANDIDATES, (t) => `${t[0]}.${t[1]}`);
  if (fromRange) return fromRange;
  const mm = parseMajorMinor(clean);
  return mm ? `${mm.major}.${mm.minor}` : undefined;
}

export function resolveJavaBuildTool(
  repoRoot: string,
  javaCfg: JavaConfig,
): { buildTool?: "maven" | "gradle"; ambiguous?: string } {
  const wdAbs = path.resolve(repoRoot, javaCfg.workingDirectory || ".");
  const hasPom = existsSync(path.join(wdAbs, "pom.xml"));
  const hasGradle =
    existsSync(path.join(wdAbs, "build.gradle")) ||
    existsSync(path.join(wdAbs, "build.gradle.kts")) ||
    existsSync(path.join(wdAbs, "settings.gradle")) ||
    existsSync(path.join(wdAbs, "settings.gradle.kts"));

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
        const cleanPy = stripLineComments(readFileSync(tf, "utf8"));
        rawVersion = resolvePythonVersionSpec(cleanPy);
        if (rawVersion) {
          source = "version-file";
          fileRel = params.langConfig.toolchainFile;
        }
      }
    }
    if (!rawVersion) {
      const pv = readFirstExisting([
        path.join(wdAbs, ".python-version"),
        path.join(params.repoRoot, ".python-version"),
      ]);
      if (pv) {
        rawVersion = resolvePythonVersionSpec(pv.content);
        if (rawVersion) {
          source = "version-file";
          fileRel = normalizeRepoRel(params.repoRoot, pv.absPath);
        }
      }
    }
    if (!rawVersion) {
      for (const pypPath of [path.join(wdAbs, "pyproject.toml"), path.join(params.repoRoot, "pyproject.toml")]) {
        if (!existsSync(pypPath)) continue;
        const cleanToml = stripLineComments(readFileSync(pypPath, "utf8"));
        const m = /requires-python\s*=\s*["']([^"']+)["']/i.exec(cleanToml);
        if (m?.[1]) {
          const resolved = resolvePythonVersionSpec(m[1]);
          if (resolved) {
            rawVersion = resolved;
            source = "version-file";
            fileRel = normalizeRepoRel(params.repoRoot, pypPath);
            break;
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
      const cleanTf = stripLineComments(readFileSync(tf, "utf8"));
      const rawTf = tf.endsWith(".sdkmanrc") ? /java=([^\s#]+)/.exec(cleanTf)?.[1] : cleanTf;
      const major = extractJavaMajor(rawTf);
      if (major !== null) {
        rawVersion = String(major);
        source = "version-file";
        fileRel = javaCfg.toolchainFile;
      }
    }
  }
  if (!rawVersion) {
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
    }
  }
  if (!rawVersion) {
    for (const pomPath of [path.join(wdAbs, "pom.xml"), path.join(params.repoRoot, "pom.xml")]) {
      if (!existsSync(pomPath)) continue;
      const cleanXml = readFileSync(pomPath, "utf8").replace(/<!--[\s\S]*?-->/g, "");
      for (const m of cleanXml.matchAll(
        /<(?:maven\.compiler\.(?:release|source|target)|java\.version)>\s*([^<\s]+)\s*</g,
      )) {
        const major = extractJavaMajor(m[1]);
        if (major !== null) {
          rawVersion = String(major);
          source = "version-file";
          fileRel = normalizeRepoRel(params.repoRoot, pomPath);
          break;
        }
      }
      if (rawVersion) break;
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
      const m =
        /(?:JavaLanguageVersion\.of\(\s*(\d+)\s*\)|JavaVersion\.VERSION_(?:1_)?(\d+)|(?:sourceCompatibility|targetCompatibility)\s*=?\s*['"]?([0-9.]+)['"]?)/.exec(
          cleanGradle,
        );
      const major = extractJavaMajor(m?.[1] ?? m?.[2] ?? m?.[3]);
      if (major !== null) {
        rawVersion = String(major);
        source = "version-file";
        fileRel = normalizeRepoRel(params.repoRoot, grPath);
        break;
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
