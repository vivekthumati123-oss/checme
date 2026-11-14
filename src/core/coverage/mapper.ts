import type { ParsedSymbol } from "../parse";

export interface MappedSymbolCoverage {
  symbol: ParsedSymbol;
  executableLines: number;
  coveredLines: number;
  coveragePct: number;
  estimated: boolean;
  changedLines: number[];
}

export function mapSymbolsToCoverage(params: {
  symbols: ParsedSymbol[];
  changedLines: ReadonlySet<number>;
  lineCoverage?: ReadonlyMap<number, number>;
}): MappedSymbolCoverage[] {
  const results: MappedSymbolCoverage[] = [];
  const changedSorted = [...params.changedLines].sort((a, b) => a - b);

  for (const sym of params.symbols) {
    const symChangedLines = changedSorted.filter((ln) => ln >= sym.startLine && ln <= sym.endLine);

    let executableLines = 0;
    let coveredLines = 0;
    let estimated = true;

    if (params.lineCoverage && params.lineCoverage.size > 0) {
      for (const [lineNum, hits] of params.lineCoverage.entries()) {
        if (lineNum >= sym.startLine && lineNum <= sym.endLine) {
          executableLines += 1;
          if (hits > 0) coveredLines += 1;
        }
      }
      if (executableLines > 0) {
        estimated = false;
      }
    }

    if (estimated) {
      executableLines = sym.executableLinesFallback;
      coveredLines = 0;
    }

    const coveragePct = executableLines > 0 ? Math.round((coveredLines / executableLines) * 100 * 100) / 100 : 0;

    results.push({
      symbol: sym,
      executableLines,
      coveredLines,
      coveragePct,
      estimated,
      changedLines: symChangedLines,
    });
  }

  return results;
}
