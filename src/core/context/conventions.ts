import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { FrameworkName, LanguageConfig, LanguageKey } from "../../contracts";
import { cleanRepoRelative, isSafeRealPathInsideRoot, normalizeSlashes } from "../paths";
import { checkNeverSend, matchesNeverSendPath } from "./never-send";

export interface DetectedConventions {
  framework: FrameworkName;
  frameworkVersion: string | null;
  mockingLibs: string[];
  testNaming: string;
  assertionStyle: string;
  styleSample?: { path: string; content: string };
}

function readPackageJson(dirAbs: string): Record<string, unknown> | null {
  const pkgPath = path.join(dirAbs, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getDepVersion(pkg: Record<string, unknown> | null, dep: string): string | null {
  if (!pkg) return null;
  const deps = (pkg.dependencies ?? {}) as Record<string, unknown>;
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, unknown>;
  const raw = devDeps[dep] ?? deps[dep];
  return typeof raw === "string" ? raw : null;
}

export interface UnsupportedFrameworkInfo {
  name: string;
  version: string | null;
  reason?: string;
}

function stripJavaBuildComments(fileName: string, raw: string): string {
  if (fileName.endsWith(".xml")) {
    return raw.replace(/<!--[\s\S]*?-->/g, "").replace(/<exclusions>[\s\S]*?<\/exclusions>/gi, "");
  }
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?:^|[\s;])\/\/.*$/gm, "");
}

function detectJavaUnsupportedFramework(
  cleanedBuildText: string,
  configured: string,
): UnsupportedFrameworkInfo | undefined {
  if (configured !== "auto" && configured !== "junit5") {
    return undefined;
  }
  if (/junit-jupiter|org\.junit\.jupiter/i.test(cleanedBuildText)) {
    return undefined;
  }
  if (/\btestng\b|org\.testng/i.test(cleanedBuildText)) {
    return {
      name: "testng",
      version: null,
      reason: "TestNG found in Java build file without JUnit 5 (junit-jupiter); only JUnit 5 is supported.",
    };
  }
  const hasJunit4Maven = /<artifactId>\s*junit\s*<\/artifactId>/i.test(cleanedBuildText);
  const gradleJunit4Match =
    /junit:junit(?::(\d[^'"\s)]*))?\b|group\s*[:=]\s*['"]junit['"][^)\n]*name\s*[:=]\s*['"]junit['"]/i.exec(
      cleanedBuildText,
    );
  if (!hasJunit4Maven && !gradleJunit4Match) {
    return undefined;
  }
  let version: string | null = gradleJunit4Match?.[1] ?? null;
  if (!version && hasJunit4Maven) {
    for (const depMatch of cleanedBuildText.matchAll(/<dependency>([\s\S]*?)<\/dependency>/gi)) {
      const block = depMatch[1] ?? "";
      if (/<artifactId>\s*junit\s*<\/artifactId>/i.test(block)) {
        const verMatch = /<version>\s*(\d[^<$\s]*)\s*<\/version>/i.exec(block);
        if (verMatch?.[1]) {
          version = verMatch[1];
          break;
        }
      }
    }
  }
  return {
    name: "junit4",
    version,
    reason: "JUnit 4 found in Java build file without JUnit 5 (junit-jupiter); only JUnit 5 is supported.",
  };
}

export function detectFrameworkForLanguage(params: {
  language: LanguageKey;
  langConfig: LanguageConfig;
  repoRoot: string;
}): {
  framework: FrameworkName;
  version: string | null;
  mockingLibs: string[];
  unsupportedFramework?: UnsupportedFrameworkInfo;
} {
  const wdAbs = path.resolve(params.repoRoot, params.langConfig.workingDirectory || ".");
  const configured = params.langConfig.framework;

  if (params.language === "javascript") {
    const wdPkg = readPackageJson(wdAbs);
    const rootPkg = path.resolve(wdAbs) === path.resolve(params.repoRoot) ? null : readPackageJson(params.repoRoot);
    const getPkgDep = (dep: string): string | null => getDepVersion(wdPkg, dep) ?? getDepVersion(rootPkg, dep);
    const vitestVer = getPkgDep("vitest");
    const jestVer = getPkgDep("jest");

    const hasVitestConfig =
      Boolean(vitestVer) ||
      existsSync(path.join(wdAbs, "vitest.config.ts")) ||
      existsSync(path.join(wdAbs, "vitest.config.mts")) ||
      existsSync(path.join(wdAbs, "vitest.config.js")) ||
      /\bvitest\b/i.test(params.langConfig.testCommand);
    const hasJestConfig =
      Boolean(jestVer) ||
      existsSync(path.join(wdAbs, "jest.config.js")) ||
      existsSync(path.join(wdAbs, "jest.config.ts")) ||
      existsSync(path.join(wdAbs, "jest.config.mjs")) ||
      /\bjest\b/i.test(params.langConfig.testCommand);

    let resolved: FrameworkName = "vitest";
    let unsupportedFramework: UnsupportedFrameworkInfo | undefined;
    if (configured === "jest" || configured === "vitest") {
      resolved = configured;
    } else if (hasVitestConfig) {
      resolved = "vitest";
    } else if (hasJestConfig) {
      resolved = "jest";
    } else {
      for (const fwName of ["mocha", "jasmine", "ava", "tap", "karma"] as const) {
        const depVer = getPkgDep(fwName);
        if (depVer || new RegExp(`\\b${fwName}\\b`, "i").test(params.langConfig.testCommand)) {
          unsupportedFramework = {
            name: fwName,
            version: depVer,
            reason: `Unsupported JavaScript test framework "${fwName}" detected; only jest and vitest are supported.`,
          };
          break;
        }
      }
    }

    return {
      framework: resolved,
      version: resolved === "vitest" ? vitestVer : jestVer,
      mockingLibs: resolved === "vitest" ? ["vi (vitest)"] : ["jest"],
      unsupportedFramework,
    };
  }

  if (params.language === "python") {
    let version: string | null = null;
    const mockingLibs = ["unittest.mock", "pytest.MonkeyPatch"];
    const pyproject = path.join(wdAbs, "pyproject.toml");
    const reqs = path.join(wdAbs, "requirements.txt");
    for (const f of [pyproject, reqs]) {
      if (!existsSync(f)) continue;
      const text = readFileSync(f, "utf8");
      const m = /pytest[~=<>!]+([0-9.]+)/i.exec(text);
      if (m?.[1]) version = m[1];
      if (/pytest-mock/i.test(text) && !mockingLibs.includes("pytest-mock (mocker)")) {
        mockingLibs.unshift("pytest-mock (mocker)");
      }
    }
    let unsupportedFramework: UnsupportedFrameworkInfo | undefined;
    if (configured === "auto") {
      const m = /\b(unittest|nose2?)\b/i.exec(params.langConfig.testCommand);
      if (m?.[1]) {
        const name = m[1].toLowerCase();
        unsupportedFramework = {
          name,
          version: null,
          reason: `Unsupported Python test framework "${name}" detected; only pytest is supported.`,
        };
      }
    }
    return {
      framework: "pytest",
      version,
      mockingLibs,
      unsupportedFramework,
    };
  }

  // Java
  const mockingLibs: string[] = [];
  let cleanedBuildText = "";
  for (const buildFile of ["pom.xml", "build.gradle", "build.gradle.kts"]) {
    const p = path.join(wdAbs, buildFile);
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, "utf8");
    cleanedBuildText += `\n${stripJavaBuildComments(buildFile, raw)}`;
    if (/mockito/i.test(raw) && !mockingLibs.includes("org.mockito.Mockito")) {
      mockingLibs.push("org.mockito.Mockito");
    }
  }
  const unsupportedFramework = detectJavaUnsupportedFramework(cleanedBuildText, configured);
  return {
    framework: "junit5",
    version: null,
    mockingLibs,
    unsupportedFramework,
  };
}

function isSampleTestFileForLanguage(relPath: string, language: LanguageKey): boolean {
  if (language === "javascript") return /\.(test|spec)\.[cm]?[jt]sx?$/i.test(relPath);
  if (language === "python") return /(?:^|\/)(?:test_[^/]+|[^/]+_test)\.py$/i.test(relPath);
  return /(?:Tests?|IT)\.java$/.test(relPath);
}

const IGNORED_SAMPLE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "target",
  "build",
  ".gradle",
  ".venv",
  "venv",
  "__pycache__",
]);

export function findClosestStyleSample(params: {
  repoRoot: string;
  workingDirectory: string;
  language: LanguageKey;
  sourcePath: string;
  neverSendGlobs?: readonly string[];
  maxChars?: number;
}): { path: string; content: string } | undefined {
  const maxChars = params.maxChars ?? 2500;
  const wdAbs = path.resolve(params.repoRoot, params.workingDirectory || ".");
  if (!existsSync(wdAbs)) return undefined;

  const neverSendGlobs = params.neverSendGlobs ?? [];
  const candidates: string[] = [];
  const walk = (dirAbs: string, depth: number): void => {
    if (depth > 12 || candidates.length >= 25) return;
    let entries;
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.isSymbolicLink() || IGNORED_SAMPLE_DIRS.has(ent.name)) {
        continue;
      }
      const full = path.join(dirAbs, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
      } else if (ent.isFile()) {
        const rel = cleanRepoRelative(normalizeSlashes(path.relative(params.repoRoot, full)));
        if (!matchesNeverSendPath(rel, neverSendGlobs) && isSampleTestFileForLanguage(rel, params.language)) {
          candidates.push(rel);
        }
      }
    }
  };

  walk(wdAbs, 0);
  if (candidates.length === 0) return undefined;

  const sourceDir = path.posix.dirname(cleanRepoRelative(normalizeSlashes(params.sourcePath)));
  candidates.sort((a, b) => {
    const aSameDir = path.posix.dirname(a) === sourceDir ? 0 : 1;
    const bSameDir = path.posix.dirname(b) === sourceDir ? 0 : 1;
    if (aSameDir !== bSameDir) return aSameDir - bSameDir;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  for (const cand of candidates) {
    if (!isSafeRealPathInsideRoot(cand, params.repoRoot, { requireRegularFileIfExists: true })) {
      continue;
    }
    try {
      const content = readFileSync(path.join(params.repoRoot, cand), "utf8");
      if (!content.trim() || checkNeverSend(cand, content, neverSendGlobs).blocked) continue;
      return {
        path: cand,
        content: content.length > maxChars ? `${content.slice(0, maxChars)}\n// ...truncated` : content,
      };
    } catch {
      continue;
    }
  }

  return undefined;
}

export function detectProjectConventions(params: {
  language: LanguageKey;
  langConfig: LanguageConfig;
  repoRoot: string;
  sourcePath: string;
  neverSendGlobs?: readonly string[];
}): DetectedConventions {
  const fw = detectFrameworkForLanguage({
    language: params.language,
    langConfig: params.langConfig,
    repoRoot: params.repoRoot,
  });

  const testNaming =
    params.language === "javascript"
      ? "describe('<unit>', () => { it('should ...', ...) })"
      : params.language === "python"
        ? "def test_<unit>_<scenario>(): ..."
        : "class <Class>Test { @Test void should<Behavior>() { ... } }";

  const assertionStyle =
    params.language === "javascript"
      ? "expect(actual).toEqual(expected)"
      : params.language === "python"
        ? "assert actual == expected / with pytest.raises(...):"
        : "Assertions.assertEquals(...) / Assertions.assertThrows(...)";

  const styleSample = findClosestStyleSample({
    repoRoot: params.repoRoot,
    workingDirectory: params.langConfig.workingDirectory,
    language: params.language,
    sourcePath: params.sourcePath,
    neverSendGlobs: params.neverSendGlobs,
  });

  return {
    framework: fw.framework,
    frameworkVersion: fw.version,
    mockingLibs: fw.mockingLibs,
    testNaming,
    assertionStyle,
    styleSample,
  };
}
