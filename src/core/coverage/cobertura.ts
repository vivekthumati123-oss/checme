import { XMLParser } from "fast-xml-parser";

import type { RawCoverageRecord } from "./lcov";

interface CoberturaLineNode {
  "@_number"?: string | number;
  "@_hits"?: string | number;
}

interface CoberturaMethodNode {
  lines?: { line?: CoberturaLineNode | CoberturaLineNode[] };
}

interface CoberturaClassNode {
  "@_filename"?: string;
  lines?: { line?: CoberturaLineNode | CoberturaLineNode[] };
  methods?: { method?: CoberturaMethodNode | CoberturaMethodNode[] };
}

interface CoberturaPackageNode {
  classes?: { class?: CoberturaClassNode | CoberturaClassNode[] };
}

interface CoberturaRoot {
  coverage?: {
    sources?: { source?: string | string[] };
    packages?: { package?: CoberturaPackageNode | CoberturaPackageNode[] };
  };
}

function asArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined) return [];
  return Array.isArray(val) ? val : [val];
}

export interface CoberturaParsedResult {
  sources: string[];
  records: RawCoverageRecord[];
}

export function parseCobertura(content: string): CoberturaParsedResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    processEntities: false,
  });

  const parsed = parser.parse(content) as CoberturaRoot;
  const cov = parsed?.coverage;
  if (!cov) {
    return { sources: [], records: [] };
  }

  const sources = asArray(cov.sources?.source)
    .map((s) => (typeof s === "string" ? s.trim() : String(s).trim()))
    .filter(Boolean);

  const byFile = new Map<string, Map<number, number>>();
  const packages = asArray(cov.packages?.package);

  for (const pkg of packages) {
    const classes = asArray(pkg.classes?.class);
    for (const cls of classes) {
      const filename = cls["@_filename"]?.trim();
      if (!filename) continue;

      let lineMap = byFile.get(filename);
      if (!lineMap) {
        lineMap = new Map<number, number>();
        byFile.set(filename, lineMap);
      }

      const collectLines = (lineNodes: CoberturaLineNode[]): void => {
        for (const ln of lineNodes) {
          const num = Number.parseInt(String(ln["@_number"] ?? ""), 10);
          const hits = Number.parseInt(String(ln["@_hits"] ?? ""), 10);
          if (Number.isFinite(num) && num >= 1 && Number.isFinite(hits) && hits >= 0) {
            const prev = lineMap!.get(num) ?? 0;
            lineMap!.set(num, Math.max(prev, hits));
          }
        }
      };

      collectLines(asArray(cls.lines?.line));
      for (const m of asArray(cls.methods?.method)) {
        collectLines(asArray(m.lines?.line));
      }
    }
  }

  const records: RawCoverageRecord[] = [];
  for (const [filePath, lines] of byFile.entries()) {
    records.push({ filePath, lines });
  }

  return { sources, records };
}
