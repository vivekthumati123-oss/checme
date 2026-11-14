import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { FrameworkName, LanguageConfig, LanguageKey } from "../../contracts";
import { cleanRepoRelative, normalizeSlashes } from "../paths";

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

export function detectFrameworkForLanguage(params: {
  language: LanguageKey;
  langConfig: LanguageConfig;
  repoRoot: string;
}): {
  framework: FrameworkName;
  version: string | null;
  mockingLibs: string[];
  unsupportedFramework?: { name: string; version: string | null };
} {
  const wdAbs = path.resolve(params.repoRoot, params.langConfig.workingDirectory || ".");
  const configured = params.langConfig.framework;

  if (params.language === "javascript") {
    const pkg = readPackageJson(wdAbs) ?? readPackageJson(params.repoRoot);
    const vitestVer = getDepVersion(pkg, "vitest");
    const jestVer = getDepVersion(pkg, "jest");

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
    let unsupportedFramework: { name: string; version: string | null } | undefined;
    if (configured === "jest" || configured === "vitest") {
      resolved = configured;
    } else if (hasVitestConfig) {
      resolved = "vitest";
    } else if (hasJestConfig) {
      resolved = "jest";
    } else {
      for (const fwName of ["mocha", "jasmine", "ava", "tap", "karma"] as const) {
        const depVer = getDepVersion(pkg, fwName);
        if (depVer || new RegExp(`\\b${fwName}\\b`, "i").test(params.langConfig.testCommand)) {
          unsupportedFramework = { name: fwName, version: depVer };
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
    let unsupportedFramework: { name: string; version: string | null } | undefined;
    if (configured === "auto") {
      const m = /\b(unittest|nose2?)\b/i.exec(params.langConfig.testCommand);
      if (m?.[1]) {
        unsupportedFramework = { name: m[1].toLowerCase(), version: null };
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
  let buildText = "";
  for (const buildFile of ["pom.xml", "build.gradle", "build.gradle.kts"]) {
    const p = path.join(wdAbs, buildFile);
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, "utf8");
    buildText += `\n${raw}`;
    if (/mockito/i.test(raw) && !mockingLibs.includes("org.mockito.Mockito")) {
      mockingLibs.push("org.mockito.Mockito");
    }
  }
  let unsupportedFramework: { name: string; version: string | null } | undefined;
  if (configured === "auto" && !/junit-jupiter/i.test(buildText)) {
    if (/\btestng\b|org\.testng/i.test(buildText)) {
      unsupportedFramework = { name: "testng", version: null };
    } else if (/<artifactId>\s*junit\s*<\/artifactId>|junit:junit\b/i.test(buildText)) {
      unsupportedFramework = { name: "junit4", version: null };
    }
  }
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

export function findClosestStyleSample(params: {
  repoRoot: string;
  workingDirectory: string;
  language: LanguageKey;
  sourcePath: string;
  maxChars?: number;
}): { path: string; content: string } | undefined {
  const maxChars = params.maxChars ?? 2500;
  const wdAbs = path.resolve(params.repoRoot, params.workingDirectory || ".");
  if (!existsSync(wdAbs)) return undefined;

  const candidates: string[] = [];
  const walk = (dirAbs: string, depth: number): void => {
    if (depth > 5 || candidates.length >= 25) return;
    let entries;
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name === "node_modules" || ent.name === ".git" || ent.name === "dist" || ent.name === "target") {
        continue;
      }
      const full = path.join(dirAbs, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
      } else if (ent.isFile()) {
        const rel = cleanRepoRelative(normalizeSlashes(path.relative(params.repoRoot, full)));
        if (isSampleTestFileForLanguage(rel, params.language)) {
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
    try {
      const content = readFileSync(path.join(params.repoRoot, cand), "utf8");
      if (!content.trim()) continue;
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
