import { existsSync } from "node:fs";
import path from "node:path";

import type { LanguageConfig, ManifestFile, UnitAgentConfig } from "../../contracts";
import {
  computePatchCoverage,
  mapSymbolsToCoverage,
  parseCoverageFile,
  type CoverageLineMap,
} from "../../core/coverage";

export interface FileCoverageEvaluation {
  coverageProduced: boolean;
  symbols: Array<{ symbolId: string; beforePct: number; afterPct: number }>;
  gainedLines: number;
  afterMap: CoverageLineMap | null;
}

function mergeFileLineCoverage(
  baseLines: Map<number, number> | undefined,
  newLines: Map<number, number> | undefined,
): Map<number, number> | undefined {
  if (!baseLines && !newLines) return undefined;
  const merged = new Map<number, number>();
  if (baseLines) {
    for (const [ln, hits] of baseLines.entries()) merged.set(ln, hits);
  }
  if (newLines) {
    for (const [ln, hits] of newLines.entries()) merged.set(ln, Math.max(merged.get(ln) ?? 0, hits));
  }
  return merged;
}

function resolveCoverageFilePathForModule(
  workspaceRoot: string,
  langConfig: LanguageConfig,
  manifestFile: ManifestFile,
): string {
  const wdRel = langConfig.workingDirectory?.trim() || ".";
  const covBase = langConfig.coverageFile.replace(/^\.\//, "");
  const fallbackAbs = path.isAbsolute(langConfig.coverageFile)
    ? langConfig.coverageFile
    : path.resolve(workspaceRoot, wdRel, langConfig.coverageFile);
  if (manifestFile.language === "java") {
    const srcMarker = manifestFile.path.indexOf("/src/");
    if (srcMarker > 0) {
      const moduleRel = manifestFile.path.slice(0, srcMarker);
      const candidateAbs = path.resolve(workspaceRoot, moduleRel, covBase);
      if (existsSync(candidateAbs)) {
        return candidateAbs;
      }
    }
  }
  return existsSync(fallbackAbs) ? fallbackAbs : langConfig.coverageFile;
}

export function evaluateFileCoverageGain(params: {
  workspaceRoot: string;
  isCopy: boolean;
  langConfig: LanguageConfig;
  manifestFile: ManifestFile;
  knownSourceFiles: readonly string[];
  baselineMap?: CoverageLineMap | null;
}): FileCoverageEvaluation {
  const effectiveCovFile = resolveCoverageFilePathForModule(
    params.workspaceRoot,
    params.langConfig,
    params.manifestFile,
  );
  const afterMap = parseCoverageFile({
    filePath: effectiveCovFile,
    format: params.langConfig.coverageFormat,
    repoRoot: params.workspaceRoot,
    workingDirectory: params.langConfig.workingDirectory,
    copyRoot: params.isCopy ? params.workspaceRoot : undefined,
    knownSourceFiles: params.knownSourceFiles,
  });

  if (!afterMap) {
    return {
      coverageProduced: false,
      symbols: params.manifestFile.symbols.map((s) => ({
        symbolId: s.symbolId,
        beforePct: s.coveragePct,
        afterPct: s.coveragePct,
      })),
      gainedLines: 0,
      afterMap: null,
    };
  }

  const baseFileCov = params.baselineMap?.get(params.manifestFile.path);
  const afterFileCov = afterMap.get(params.manifestFile.path);
  const unionFileCov = mergeFileLineCoverage(baseFileCov, afterFileCov);
  const symbolResults: Array<{ symbolId: string; beforePct: number; afterPct: number }> = [];
  let gainedLines = 0;

  for (const sym of params.manifestFile.symbols) {
    const mapped = mapSymbolsToCoverage({
      symbols: [
        {
          symbolId: sym.symbolId,
          qualifiedName: sym.qualifiedName,
          kind: sym.kind,
          signature: sym.signature,
          startLine: sym.range.startLine,
          endLine: sym.range.endLine,
          complexity: sym.complexity,
          executableLinesFallback: sym.executableLines,
          exported: true,
          abstract: false,
          trivial: false,
          isTest: false,
        },
      ],
      changedLines: new Set(sym.changedLines),
      lineCoverage: unionFileCov,
    })[0];

    const afterPct = mapped && !mapped.estimated ? mapped.coveragePct : sym.coveragePct;
    const afterCovered = mapped && !mapped.estimated ? mapped.coveredLines : sym.coveredLines;
    const baselineCovered = params.baselineMap === null ? 0 : sym.coveredLines;
    if (afterCovered > baselineCovered) {
      gainedLines += afterCovered - baselineCovered;
    }

    symbolResults.push({
      symbolId: sym.symbolId,
      beforePct: sym.coveragePct,
      afterPct,
    });
  }

  return {
    coverageProduced: true,
    symbols: symbolResults,
    gainedLines,
    afterMap,
  };
}

export function computeProjectedPatchCoverage(params: {
  manifestFiles: readonly ManifestFile[];
  config: UnitAgentConfig;
  coverageMaps: readonly CoverageLineMap[];
}): number | null {
  const changedByFile = new Map<string, Set<number>>();
  for (const mf of params.manifestFiles) {
    const lines = new Set<number>();
    for (const s of mf.symbols) {
      for (const ln of s.changedLines) lines.add(ln);
    }
    changedByFile.set(mf.path, lines);
  }

  const merged: CoverageLineMap = new Map();
  for (const m of params.coverageMaps) {
    for (const [filePath, lineHits] of m.entries()) {
      let dest = merged.get(filePath);
      if (!dest) {
        dest = new Map<number, number>();
        merged.set(filePath, dest);
      }
      for (const [ln, hits] of lineHits.entries()) {
        dest.set(ln, Math.max(dest.get(ln) ?? 0, hits));
      }
    }
  }

  if (merged.size === 0) return null;
  return computePatchCoverage({ changedLinesByFile: changedByFile, coverageMap: merged }).patchCoveragePct;
}
