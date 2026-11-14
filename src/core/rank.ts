import type { LanguageKey, ManifestSymbol, SkipReason } from "../contracts";
import type { MappedSymbolCoverage } from "./coverage";

export interface CandidateSymbolInput {
  filePath: string;
  language: LanguageKey;
  mapped: MappedSymbolCoverage;
}

export interface RankedCandidate extends CandidateSymbolInput {
  score: number;
  manifestSymbol: ManifestSymbol;
}

export interface RankSkippedItem {
  path: string;
  symbolId: string;
  reason: SkipReason;
  detail: string;
}

export interface RankedFileGroup {
  filePath: string;
  language: LanguageKey;
  maxScore: number;
  symbols: ManifestSymbol[];
}

export interface RankSelectionResult {
  selectedFiles: RankedFileGroup[];
  skipped: RankSkippedItem[];
}

export function computeSymbolScore(input: MappedSymbolCoverage): number {
  const denom = input.executableLines > 0 ? input.executableLines : Math.max(1, input.symbol.executableLinesFallback);
  const changedLineRatio = Math.min(1, input.changedLines.length / denom);
  const uncoveredFraction = Math.max(0, Math.min(1, 1 - input.coveragePct / 100));
  const complexityTerm = Math.min(input.symbol.complexity / 10, 1.5);
  const publicBonus = input.symbol.exported ? 1 : 0;

  const raw = 3.0 * changedLineRatio + 2.0 * uncoveredFraction + 1.0 * complexityTerm + 0.5 * publicBonus;
  return Math.round(raw * 1e6) / 1e6;
}

function cmpAsc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function rankAndSelectSymbols(params: {
  candidates: CandidateSymbolInput[];
  maxSymbolsPerPr: number;
  maxFilesPerPr: number;
}): RankSelectionResult {
  const scored: RankedCandidate[] = params.candidates.map((cand) => {
    const score = computeSymbolScore(cand.mapped);
    return {
      ...cand,
      score,
      manifestSymbol: {
        symbolId: cand.mapped.symbol.symbolId,
        qualifiedName: cand.mapped.symbol.qualifiedName,
        kind: cand.mapped.symbol.kind,
        signature: cand.mapped.symbol.signature,
        range: {
          startLine: cand.mapped.symbol.startLine,
          endLine: cand.mapped.symbol.endLine,
        },
        executableLines: cand.mapped.executableLines,
        estimated: cand.mapped.estimated ? true : undefined,
        coveredLines: cand.mapped.coveredLines,
        coveragePct: cand.mapped.coveragePct,
        changedLines: cand.mapped.changedLines,
        complexity: cand.mapped.symbol.complexity,
        score,
      },
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.manifestSymbol.changedLines.length !== a.manifestSymbol.changedLines.length) {
      return b.manifestSymbol.changedLines.length - a.manifestSymbol.changedLines.length;
    }
    const pathCmp = cmpAsc(a.filePath, b.filePath);
    if (pathCmp !== 0) return pathCmp;
    if (a.manifestSymbol.range.startLine !== b.manifestSymbol.range.startLine) {
      return a.manifestSymbol.range.startLine - b.manifestSymbol.range.startLine;
    }
    return cmpAsc(a.manifestSymbol.symbolId, b.manifestSymbol.symbolId);
  });

  const selectedFilesMap = new Map<string, RankedFileGroup>();
  const skipped: RankSkippedItem[] = [];
  let selectedSymbolCount = 0;

  for (const item of scored) {
    const existingGroup = selectedFilesMap.get(item.filePath);
    if (!existingGroup && selectedFilesMap.size >= params.maxFilesPerPr) {
      skipped.push({
        path: item.filePath,
        symbolId: item.manifestSymbol.symbolId,
        reason: "over_file_cap",
        detail: `Exceeds limits.maxFilesPerPr (${params.maxFilesPerPr}).`,
      });
      continue;
    }
    if (selectedSymbolCount >= params.maxSymbolsPerPr) {
      skipped.push({
        path: item.filePath,
        symbolId: item.manifestSymbol.symbolId,
        reason: "over_symbol_cap",
        detail: `Exceeds limits.maxSymbolsPerPr (${params.maxSymbolsPerPr}).`,
      });
      continue;
    }

    if (existingGroup) {
      existingGroup.symbols.push(item.manifestSymbol);
      if (item.score > existingGroup.maxScore) {
        existingGroup.maxScore = item.score;
      }
    } else {
      selectedFilesMap.set(item.filePath, {
        filePath: item.filePath,
        language: item.language,
        maxScore: item.score,
        symbols: [item.manifestSymbol],
      });
    }
    selectedSymbolCount += 1;
  }

  const selectedFiles = [...selectedFilesMap.values()].sort((a, b) => {
    if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore;
    return cmpAsc(a.filePath, b.filePath);
  });

  return { selectedFiles, skipped };
}
