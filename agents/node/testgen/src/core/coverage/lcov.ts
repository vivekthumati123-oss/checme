export interface RawCoverageRecord {
  filePath: string;
  lines: Map<number, number>;
}

/**
 * Parses `FN:<line>,<name>` or LCOV 2.0 `FN:<startLine>,<endLine>,<name>` entries.
 */
function parseFnEntry(payload: string): { lineNum: number; name: string } | null {
  const firstComma = payload.indexOf(",");
  if (firstComma <= 0) return null;
  const lineNum = Number.parseInt(payload.slice(0, firstComma), 10);
  if (!Number.isFinite(lineNum) || lineNum < 1) return null;

  const rest = payload.slice(firstComma + 1);
  const secondComma = rest.indexOf(",");
  if (secondComma > 0 && /^\d+$/.test(rest.slice(0, secondComma).trim())) {
    const name = rest.slice(secondComma + 1).trim();
    return name ? { lineNum, name } : null;
  }

  const name = rest.trim();
  return name ? { lineNum, name } : null;
}

/**
 * Overrides module-evaluation DA hits with 0 when a line declares functions whose FNDA hit counts are all 0.
 */
function applyUncalledFunctionLineOverrides(
  lines: Map<number, number>,
  fnLineToNames: Map<number, Set<string>>,
  fnHits: Map<string, number>,
): void {
  for (const [lineNum, names] of fnLineToNames.entries()) {
    if (!lines.has(lineNum)) continue;
    const recordedHits: number[] = [];
    for (const name of names) {
      const hits = fnHits.get(name);
      if (hits !== undefined) {
        recordedHits.push(hits);
      }
    }
    if (recordedHits.length > 0 && recordedHits.every((hits) => hits === 0)) {
      lines.set(lineNum, 0);
    }
  }
}

export function parseLcov(content: string): RawCoverageRecord[] {
  const records: RawCoverageRecord[] = [];
  let currentPath: string | null = null;
  let currentLines = new Map<number, number>();
  let fnLineToNames = new Map<number, Set<string>>();
  let fnHits = new Map<string, number>();

  const flushRecord = (): void => {
    if (currentPath === null) return;
    applyUncalledFunctionLineOverrides(currentLines, fnLineToNames, fnHits);
    records.push({ filePath: currentPath, lines: currentLines });
    currentPath = null;
    currentLines = new Map<number, number>();
    fnLineToNames = new Map<number, Set<string>>();
    fnHits = new Map<string, number>();
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("SF:")) {
      flushRecord();
      currentPath = line.slice(3).trim();
      continue;
    }

    if (currentPath === null) continue;

    if (line.startsWith("FN:")) {
      const entry = parseFnEntry(line.slice(3));
      if (entry) {
        let names = fnLineToNames.get(entry.lineNum);
        if (!names) {
          names = new Set<string>();
          fnLineToNames.set(entry.lineNum, names);
        }
        names.add(entry.name);
      }
      continue;
    }

    if (line.startsWith("FNDA:")) {
      const payload = line.slice(5);
      const commaIdx = payload.indexOf(",");
      if (commaIdx > 0) {
        const hits = Number.parseInt(payload.slice(0, commaIdx), 10);
        const name = payload.slice(commaIdx + 1).trim();
        if (Number.isFinite(hits) && hits >= 0 && name) {
          const prev = fnHits.get(name) ?? 0;
          fnHits.set(name, Math.max(prev, hits));
        }
      }
      continue;
    }

    if (line.startsWith("DA:")) {
      const payload = line.slice(3);
      const [lineStr, hitsStr] = payload.split(",");
      const lineNum = Number.parseInt(lineStr ?? "", 10);
      const hits = Number.parseInt(hitsStr ?? "", 10);
      if (Number.isFinite(lineNum) && lineNum >= 1 && Number.isFinite(hits) && hits >= 0) {
        const prev = currentLines.get(lineNum) ?? 0;
        currentLines.set(lineNum, Math.max(prev, hits));
      }
      continue;
    }

    if (line === "end_of_record") {
      flushRecord();
    }
  }

  flushRecord();

  return records;
}
