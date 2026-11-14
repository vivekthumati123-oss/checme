import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { FileContext, LanguageKey, ManifestSymbol, PythonConfig, UnitAgentConfig } from "../../contracts";
import { parseSourceFile, type ParsedSymbol } from "../parse";
import { cleanRepoRelative, normalizeSlashes } from "../paths";
import { detectProjectConventions } from "./conventions";
import { computeImportHint } from "./import-hints";

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

async function resolveOneHopSignatures(params: {
  repoRoot: string;
  sourcePath: string;
  imports: readonly string[];
  language: LanguageKey;
}): Promise<string[]> {
  const sigs: string[] = [];
  const srcDir = path.posix.dirname(cleanRepoRelative(normalizeSlashes(params.sourcePath)));

  for (const imp of params.imports.slice(0, 8)) {
    if (!imp.startsWith(".")) continue;
    const baseRel = path.posix.normalize(path.posix.join(srcDir, imp));
    const exts =
      params.language === "javascript" ? [".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.js", ""] : [".py", ""];
    for (const ext of exts) {
      const candidate = cleanRepoRelative(`${baseRel.replace(/\.(js|ts)$/, "")}${ext}`);
      const abs = path.join(params.repoRoot, candidate);
      if (!existsSync(abs)) continue;
      try {
        const raw = readFileSync(abs, "utf8");
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

  const conventions = detectProjectConventions({
    language: params.language,
    langConfig: langCfg,
    repoRoot: params.repoRoot,
    sourcePath: params.sourcePath,
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
