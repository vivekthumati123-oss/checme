import type { CoverageLineMap } from "./normalize";

export interface PatchCoverageStats {
  coveredChangedLines: number;
  totalChangedExecutableLines: number;
  patchCoveragePct: number | null;
}

export function computePatchCoverage(params: {
  changedLinesByFile: ReadonlyMap<string, ReadonlySet<number>>;
  coverageMap: CoverageLineMap | null;
}): PatchCoverageStats {
  if (!params.coverageMap) {
    return {
      coveredChangedLines: 0,
      totalChangedExecutableLines: 0,
      patchCoveragePct: null,
    };
  }

  let totalExec = 0;
  let coveredExec = 0;

  for (const [filePath, changedSet] of params.changedLinesByFile.entries()) {
    const fileCov = params.coverageMap.get(filePath);
    if (!fileCov) continue;

    for (const lineNum of changedSet) {
      const hits = fileCov.get(lineNum);
      if (hits === undefined) continue;
      totalExec += 1;
      if (hits > 0) coveredExec += 1;
    }
  }

  if (totalExec === 0) {
    return {
      coveredChangedLines: 0,
      totalChangedExecutableLines: 0,
      patchCoveragePct: null,
    };
  }

  return {
    coveredChangedLines: coveredExec,
    totalChangedExecutableLines: totalExec,
    patchCoveragePct: Math.round((coveredExec / totalExec) * 100 * 100) / 100,
  };
}

export function computeFileExecutableCoveragePct(fileCov: ReadonlyMap<number, number> | undefined): number | null {
  if (!fileCov || fileCov.size === 0) return null;
  let total = 0;
  let covered = 0;
  for (const hits of fileCov.values()) {
    total += 1;
    if (hits > 0) covered += 1;
  }
  if (total === 0) return null;
  return Math.round((covered / total) * 100 * 100) / 100;
}
