import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { cleanRepoRelative, normalizeSlashes, toRepoPath } from "../paths";
import { parseCobertura } from "./cobertura";
import { parseJacoco } from "./jacoco";
import { parseLcov, type RawCoverageRecord } from "./lcov";

export type CoverageFormat = "lcov" | "cobertura" | "jacoco";
export type CoverageLineMap = Map<string, Map<number, number>>;

export interface NormalizeCoverageOptions {
  format: CoverageFormat;
  content: string;
  repoRoot: string;
  workingDirectory?: string;
  copyRoot?: string;
  knownSourceFiles?: readonly string[];
}

function resolveCoverageRecordPath(
  rawFilePath: string,
  opts: {
    format: CoverageFormat;
    sources?: string[];
    repoRoot: string;
    workingDirectory?: string;
    copyRoot?: string;
    knownSourceFiles?: readonly string[];
  },
): string | null {
  const normRaw = normalizeSlashes(rawFilePath.trim());
  const normalizedKnown = opts.knownSourceFiles?.map((k) => cleanRepoRelative(normalizeSlashes(k))) ?? [];

  if (opts.format === "jacoco") {
    const candidates = normalizedKnown.filter(
      (k) => k.endsWith(`/${normRaw}`) || k === normRaw || k.endsWith(`src/main/java/${normRaw}`),
    );
    if (candidates.length === 1 && candidates[0]) {
      return candidates[0];
    }
    if (candidates.length > 1) {
      const wd = opts.workingDirectory ? cleanRepoRelative(opts.workingDirectory) : "";
      if (wd && wd !== ".") {
        const underWd = candidates.find((c) => c.startsWith(`${wd}/`));
        if (underWd) return underWd;
      }
      return candidates[0] ?? null;
    }
    const defaultJavaRel =
      opts.workingDirectory && opts.workingDirectory !== "."
        ? `${cleanRepoRelative(opts.workingDirectory)}/src/main/java/${normRaw}`
        : `src/main/java/${normRaw}`;
    return cleanRepoRelative(defaultJavaRel);
  }

  const isRawAbs = path.posix.isAbsolute(normRaw) || /^[A-Za-z]:\//.test(normRaw);

  // For Cobertura reports carrying <sources>, resolve relative filenames against <source>
  // prefixes before falling back to direct repoRoot-relative normalization.
  if (!isRawAbs && opts.sources?.length && !normalizedKnown.includes(cleanRepoRelative(normRaw))) {
    const cleanRaw = cleanRepoRelative(normRaw);
    for (const srcPrefix of opts.sources) {
      const normSrc = normalizeSlashes(srcPrefix).replace(/\/+$/, "");
      if (!normSrc) continue;
      const combined = `${normSrc}/${cleanRaw}`;
      try {
        const combinedRel = toRepoPath(combined, opts.repoRoot, {
          copyRoot: opts.copyRoot,
          workingDirectory: opts.workingDirectory,
        });
        if (normalizedKnown.length === 0 || normalizedKnown.includes(combinedRel)) {
          return combinedRel;
        }
        const suffixFromCombinedRel = normalizedKnown.find((k) => k === combinedRel || k.endsWith(`/${combinedRel}`));
        if (suffixFromCombinedRel) return suffixFromCombinedRel;
      } catch {
        const cleanCombined = cleanRepoRelative(combined);
        const suffixFromCombined = normalizedKnown.find(
          (k) => combined.endsWith(`/${k}`) || combined === k || cleanCombined.endsWith(`/${k}`) || cleanCombined === k,
        );
        if (suffixFromCombined) return suffixFromCombined;
      }
    }
  }

  // First try direct repo normalization
  try {
    const repoRel = toRepoPath(normRaw, opts.repoRoot, {
      copyRoot: opts.copyRoot,
      workingDirectory: opts.workingDirectory,
    });
    if (normalizedKnown.length > 0 && !normalizedKnown.includes(repoRel)) {
      const suffixMatch = normalizedKnown.find((k) => k === repoRel || k.endsWith(`/${repoRel}`));
      if (suffixMatch) return suffixMatch;
    }
    return repoRel;
  } catch {
    // External dependency path OR container mount prefix or Cobertura <source> prefix
  }

  for (const known of normalizedKnown) {
    if (normRaw === known || normRaw.endsWith(`/${known}`)) {
      return known;
    }
  }

  // Fallback for workingDirectory + rawFilePath when raw path carried an unmapped absolute root
  const wd = opts.workingDirectory ? cleanRepoRelative(opts.workingDirectory) : "";
  if (wd && wd !== "." && !normRaw.startsWith("/")) {
    const joined = cleanRepoRelative(`${wd}/${normRaw}`);
    if (normalizedKnown.length === 0 || normalizedKnown.includes(joined)) {
      return joined;
    }
  }

  return null;
}

export function normalizeCoverageContent(opts: NormalizeCoverageOptions): CoverageLineMap {
  let rawRecords: RawCoverageRecord[];
  let sources: string[] | undefined;

  if (opts.format === "lcov") {
    rawRecords = parseLcov(opts.content);
  } else if (opts.format === "cobertura") {
    const parsed = parseCobertura(opts.content);
    rawRecords = parsed.records;
    sources = parsed.sources;
  } else {
    rawRecords = parseJacoco(opts.content);
  }

  const out: CoverageLineMap = new Map();

  for (const rec of rawRecords) {
    const repoPath = resolveCoverageRecordPath(rec.filePath, {
      format: opts.format,
      sources,
      repoRoot: opts.repoRoot,
      workingDirectory: opts.workingDirectory,
      copyRoot: opts.copyRoot,
      knownSourceFiles: opts.knownSourceFiles,
    });
    if (!repoPath) continue;

    let merged = out.get(repoPath);
    if (!merged) {
      merged = new Map<number, number>();
      out.set(repoPath, merged);
    }
    for (const [lineNum, hits] of rec.lines.entries()) {
      const prev = merged.get(lineNum) ?? 0;
      merged.set(lineNum, Math.max(prev, hits));
    }
  }

  return out;
}

export function parseCoverageFile(params: {
  filePath: string;
  format: CoverageFormat;
  repoRoot: string;
  workingDirectory?: string;
  copyRoot?: string;
  knownSourceFiles?: readonly string[];
}): CoverageLineMap | null {
  const absPath = path.isAbsolute(params.filePath)
    ? params.filePath
    : path.resolve(params.repoRoot, params.workingDirectory ?? ".", params.filePath);

  if (!existsSync(absPath)) {
    return null;
  }
  const content = readFileSync(absPath, "utf8");
  return normalizeCoverageContent({
    format: params.format,
    content,
    repoRoot: params.repoRoot,
    workingDirectory: params.workingDirectory,
    copyRoot: params.copyRoot,
    knownSourceFiles: params.knownSourceFiles,
  });
}
