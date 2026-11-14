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

export function evaluateFileCoverageGain(params: {
  workspaceRoot: string;
  isCopy: boolean;
  langConfig: LanguageConfig;
  manifestFile: ManifestFile;
  knownSourceFiles: readonly string[];
}): FileCoverageEvaluation {
  const afterMap = parseCoverageFile({
    filePath: params.langConfig.coverageFile,
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

  const fileCov = afterMap.get(params.manifestFile.path);
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
      lineCoverage: fileCov,
    })[0];

    const afterPct = mapped && !mapped.estimated ? mapped.coveragePct : sym.coveragePct;
    const afterCovered = mapped && !mapped.estimated ? mapped.coveredLines : sym.coveredLines;
    if (afterCovered > sym.coveredLines) {
      gainedLines += afterCovered - sym.coveredLines;
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
