export interface RawCoverageRecord {
  filePath: string;
  lines: Map<number, number>;
}

export function parseLcov(content: string): RawCoverageRecord[] {
  const records: RawCoverageRecord[] = [];
  let currentPath: string | null = null;
  let currentLines = new Map<number, number>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("SF:")) {
      if (currentPath !== null) {
        records.push({ filePath: currentPath, lines: currentLines });
      }
      currentPath = line.slice(3).trim();
      currentLines = new Map<number, number>();
      continue;
    }

    if (line.startsWith("DA:") && currentPath !== null) {
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

    if (line === "end_of_record" && currentPath !== null) {
      records.push({ filePath: currentPath, lines: currentLines });
      currentPath = null;
      currentLines = new Map<number, number>();
    }
  }

  if (currentPath !== null) {
    records.push({ filePath: currentPath, lines: currentLines });
  }

  return records;
}
