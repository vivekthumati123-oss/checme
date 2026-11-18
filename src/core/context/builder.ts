import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { FileContext, LanguageKey, ManifestSymbol, PythonConfig, UnitAgentConfig } from "../../contracts";
import { parseSourceFile, type ParsedSymbol } from "../parse";
import { cleanRepoRelative, isSafeRealPathInsideRoot, normalizeSlashes, toRepoPath } from "../paths";
import { detectProjectConventions } from "./conventions";
import { computeImportHint } from "./import-hints";
import { checkNeverSend, matchesNeverSendPath } from "./never-send";

export function makeFileId(repoRelPath: string): string {
  const norm = cleanRepoRelative(normalizeSlashes(repoRelPath));
  const hash = createHash("sha256").update(norm).digest("hex").slice(0, 8);
  const stem = path.posix
    .parse(norm)
    .name.replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return `${stem || "file"}_${hash}`;
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildClassSkeleton(symbols: readonly ParsedSymbol[]): string | undefined {
  const classMembers = symbols.filter((s) => s.className);
  if (classMembers.length === 0) return undefined;
  const lines = classMembers.slice(0, 25).map((s) => `// L${s.startLine}-${s.endLine}: ${s.signature}`);
  return lines.join("\n");
}

function sliceSourceWithinBudget(
  sourceContent: string,
  targets: readonly ManifestSymbol[],
  budgetChars: number,
): { content: string; truncated: boolean } {
  if (sourceContent.length <= budgetChars) {
    return { content: sourceContent, truncated: false };
  }

  const lines = sourceContent.split(/\r?\n/);
  const minLine = Math.max(1, Math.min(...targets.map((t) => t.range.startLine)) - 15);
  const maxLine = Math.min(lines.length, Math.max(...targets.map((t) => t.range.endLine)) + 15);

  const importHeader = lines.slice(0, Math.min(30, minLine - 1)).join("\n");
  const targetWindow = lines
    .slice(minLine - 1, maxLine)
    .map((line, idx) => `${minLine + idx}: ${line}`)
    .join("\n");

  const combined = `${importHeader}\n\n// ... sliced lines ${minLine}-${maxLine} of ${lines.length} ...\n${targetWindow}`;
  if (combined.length <= budgetChars) {
    return { content: combined, truncated: true };
  }
  return {
    content: `${combined.slice(0, Math.max(200, budgetChars - 32))}\n// ...truncated`,
    truncated: true,
  };
}

function buildOneHopCandidates(srcDir: string, imp: string, language: LanguageKey): string[] {
  if (!imp.startsWith(".")) return [];

  if (language === "python") {
    const dotMatch = /^(\.+)(.*)$/.exec(imp);
    if (!dotMatch) return [];
    const upLevels = dotMatch[1]!.length - 1;
    const baseParts = srcDir && srcDir !== "." ? srcDir.split("/").filter(Boolean) : [];
    if (upLevels > baseParts.length) return [];
    const parentParts = upLevels > 0 ? baseParts.slice(0, baseParts.length - upLevels) : baseParts;
    const modRel = dotMatch[2]!.trim().replace(/\./g, "/");
    if (modRel.split("/").includes("..")) return [];
    const joined = [...parentParts, ...(modRel ? modRel.split("/").filter(Boolean) : [])].join("/");
    if (!joined) return ["__init__.py"];
    return modRel ? [`${joined}.py`, `${joined}/__init__.py`, joined] : [`${joined}/__init__.py`];
  }

  if (language !== "javascript") return [];

  const normSrcDir = srcDir === "." ? "" : srcDir;
  const baseRel = cleanRepoRelative(path.posix.normalize(normSrcDir ? `${normSrcDir}/${imp}` : imp));
  if (!baseRel || baseRel === "." || baseRel === ".." || baseRel.startsWith("../")) {
    return [];
  }
  const stripped = baseRel.replace(/\.(mjs|cjs|mts|cts|tsx|ts|jsx|js)$/i, "");
  const cands = [
    baseRel,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    `${stripped}.mts`,
    `${stripped}.cts`,
    `${stripped}.js`,
    `${stripped}.mjs`,
    `${stripped}.cjs`,
    `${stripped}.jsx`,
    `${stripped}/index.ts`,
    `${stripped}/index.tsx`,
    `${stripped}/index.js`,
    `${stripped}/index.mts`,
    `${stripped}/index.mjs`,
  ];
  return [...new Set(cands)];
}

async function resolveOneHopSignatures(params: {
  repoRoot: string;
  sourcePath: string;
  imports: readonly string[];
  language: LanguageKey;
  neverSendGlobs: readonly string[];
}): Promise<string[]> {
  const sigs: string[] = [];
  const srcDir = path.posix.dirname(cleanRepoRelative(normalizeSlashes(params.sourcePath)));

  for (const imp of params.imports.slice(0, 8)) {
    const candidates = buildOneHopCandidates(srcDir, imp, params.language);
    for (const rawCandidate of candidates) {
      let candidate: string;
      try {
        candidate = toRepoPath(rawCandidate, params.repoRoot);
      } catch {
        continue;
      }
      if (matchesNeverSendPath(candidate, params.neverSendGlobs)) {
        break;
      }
      if (!isSafeRealPathInsideRoot(candidate, params.repoRoot, { requireRegularFileIfExists: true })) {
        continue;
      }
      const abs = path.join(params.repoRoot, candidate);
      try {
        const raw = readFileSync(abs, "utf8");
        if (checkNeverSend(candidate, raw, params.neverSendGlobs).blocked) {
          break;
        }
        const parsed = await parseSourceFile({ filePath: candidate, content: raw, language: params.language });
        for (const sym of parsed.allSymbols.filter((s) => s.exported).slice(0, 5)) {
          sigs.push(`${candidate}: ${sym.signature}`);
        }
        break;
      } catch {
        break;
      }
    }
  }

  return sigs.slice(0, 12);
}

export async function buildFileContextPacket(params: {
  repoRoot: string;
  config: UnitAgentConfig;
  fileId: string;
  language: LanguageKey;
  sourcePath: string;
  testPath: string;
  sourceContent: string;
  symbols: ManifestSymbol[];
  allParsedSymbols: ParsedSymbol[];
  imports: string[];
  packageName?: string;
  primaryClassName?: string;
}): Promise<FileContext> {
  const langCfg = params.config.languages[params.language];
  if (!langCfg) {
    throw new Error(`Missing language configuration for ${params.language}`);
  }

  const neverSendGlobs = params.config.privacy.neverSend;
  const sourceCheck = checkNeverSend(params.sourcePath, params.sourceContent, neverSendGlobs);
  if (sourceCheck.blocked) {
    throw new Error(`Refusing to build context packet for blocked source file: ${sourceCheck.detail}`);
  }

  const conventions = detectProjectConventions({
    language: params.language,
    langConfig: langCfg,
    repoRoot: params.repoRoot,
    sourcePath: params.sourcePath,
    neverSendGlobs,
  });

  const pyCfg = params.language === "python" ? (langCfg as PythonConfig) : undefined;
  const importHint = computeImportHint({
    language: params.language,
    repoRoot: params.repoRoot,
    workingDirectory: langCfg.workingDirectory,
    sourcePath: params.sourcePath,
    testPath: params.testPath,
    packageName: params.packageName,
    primaryClassName: params.primaryClassName,
    configuredPythonPath: pyCfg?.pythonPath,
    sourceContent: params.sourceContent,
  });

  const maxChars = params.config.limits.maxContextChars;
  const sourceBudget = Math.max(1000, Math.floor(maxChars * 0.72));
  const slicedSource = sliceSourceWithinBudget(params.sourceContent, params.symbols, sourceBudget);
  const classSkeleton = buildClassSkeleton(params.allParsedSymbols);
  const referencedSignatures = await resolveOneHopSignatures({
    repoRoot: params.repoRoot,
    sourcePath: params.sourcePath,
    imports: params.imports,
    language: params.language,
    neverSendGlobs,
  });

  let styleSample = conventions.styleSample;
  if (styleSample) {
    const usedSoFar =
      slicedSource.content.length + (classSkeleton?.length ?? 0) + referencedSignatures.join("\n").length;
    const remainingBudget = maxChars - usedSoFar - 500;
    if (remainingBudget < 200) {
      styleSample = undefined;
    } else if (styleSample.content.length > remainingBudget) {
      styleSample = {
        path: styleSample.path,
        content: `${styleSample.content.slice(0, remainingBudget - 24)}\n// ...truncated`,
      };
    }
  }

  return {
    schemaVersion: 1,
    fileId: params.fileId,
    language: params.language,
    framework: conventions.framework,
    frameworkVersion: conventions.frameworkVersion,
    mockingLibs: conventions.mockingLibs,
    conventions: {
      testNaming: conventions.testNaming,
      assertionStyle: conventions.assertionStyle,
      importHint,
      testPath: params.testPath,
    },
    sourceFile: {
      path: params.sourcePath,
      content: slicedSource.content,
      truncated: slicedSource.truncated,
    },
    targets: params.symbols.map((s) => ({
      symbolId: s.symbolId,
      qualifiedName: s.qualifiedName,
      signature: s.signature,
      startLine: s.range.startLine,
      endLine: s.range.endLine,
    })),
    classSkeleton,
    referencedSignatures,
    styleSample,
  };
}
