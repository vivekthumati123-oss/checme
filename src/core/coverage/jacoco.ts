import { XMLParser } from "fast-xml-parser";

import type { RawCoverageRecord } from "./lcov";

interface JacocoLineNode {
  "@_nr"?: string | number;
  "@_mi"?: string | number;
  "@_ci"?: string | number;
}

interface JacocoSourceFileNode {
  "@_name"?: string;
  line?: JacocoLineNode | JacocoLineNode[];
}

interface JacocoPackageNode {
  "@_name"?: string;
  sourcefile?: JacocoSourceFileNode | JacocoSourceFileNode[];
}

interface JacocoGroupNode {
  package?: JacocoPackageNode | JacocoPackageNode[];
  group?: JacocoGroupNode | JacocoGroupNode[];
}

interface JacocoRoot {
  report?: {
    package?: JacocoPackageNode | JacocoPackageNode[];
    group?: JacocoGroupNode | JacocoGroupNode[];
  };
}

function asArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined) return [];
  return Array.isArray(val) ? val : [val];
}

function collectPackagesFromGroup(group: JacocoGroupNode, out: JacocoPackageNode[]): void {
  out.push(...asArray(group.package));
  for (const childGroup of asArray(group.group)) {
    collectPackagesFromGroup(childGroup, out);
  }
}

export function parseJacoco(content: string): RawCoverageRecord[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    processEntities: false,
    parseTagValue: false,
  });

  const parsed = parser.parse(content) as JacocoRoot;
  const report = parsed?.report;
  if (!report) return [];

  const packages: JacocoPackageNode[] = [...asArray(report.package)];
  for (const grp of asArray(report.group)) {
    collectPackagesFromGroup(grp, packages);
  }

  const byFile = new Map<string, Map<number, number>>();

  for (const pkg of packages) {
    const pkgName = (pkg["@_name"] ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    for (const sf of asArray(pkg.sourcefile)) {
      const sfName = sf["@_name"]?.trim();
      if (!sfName) continue;
      const logicalPath = pkgName ? `${pkgName}/${sfName}` : sfName;

      let lineMap = byFile.get(logicalPath);
      if (!lineMap) {
        lineMap = new Map<number, number>();
        byFile.set(logicalPath, lineMap);
      }

      for (const ln of asArray(sf.line)) {
        const nr = Number.parseInt(String(ln["@_nr"] ?? ""), 10);
        const ci = Number.parseInt(String(ln["@_ci"] ?? "0"), 10);
        if (Number.isFinite(nr) && nr >= 1 && Number.isFinite(ci)) {
          const hits = ci > 0 ? 1 : 0;
          const prev = lineMap.get(nr) ?? 0;
          lineMap.set(nr, Math.max(prev, hits));
        }
      }
    }
  }

  const records: RawCoverageRecord[] = [];
  for (const [filePath, lines] of byFile.entries()) {
    records.push({ filePath, lines });
  }
  return records;
}
