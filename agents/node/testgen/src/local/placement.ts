import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { checkCommitPath } from "../core/commit-paths";
import { cleanRepoRelative, isSafeRealPathInsideRoot, normalizeSlashes, toRepoPath } from "../core/paths";

export interface PlacedEntry {
  path: string;
  placedAt: string;
}

function getPlacedPaths(workDir: string): string[] {
  return [path.join(workDir, "chat", "placed.json"), path.join(workDir, "placed.json")];
}

function readPlacedEntries(filePath: string): PlacedEntry[] {
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PlacedEntry => Boolean(e) && typeof e === "object" && typeof (e as PlacedEntry).path === "string",
    );
  } catch {
    return [];
  }
}

export function recordPlacedFile(workDir: string, relPath: string, localMode = true): void {
  const targetJson = localMode ? path.join(workDir, "chat", "placed.json") : path.join(workDir, "placed.json");
  const norm = cleanRepoRelative(normalizeSlashes(relPath));
  const current = readPlacedEntries(targetJson).filter((e) => e.path !== norm);
  current.push({ path: norm, placedAt: new Date().toISOString() });
  mkdirSync(path.dirname(targetJson), { recursive: true });
  writeFileSync(targetJson, `${JSON.stringify(current, null, 2)}\n`, "utf8");
}

export function unrecordPlacedFile(workDir: string, relPath: string, localMode = true): void {
  const norm = cleanRepoRelative(normalizeSlashes(relPath));
  const targets = localMode ? [path.join(workDir, "chat", "placed.json")] : [path.join(workDir, "placed.json")];
  for (const targetJson of targets) {
    if (!existsSync(targetJson)) continue;
    const remaining = readPlacedEntries(targetJson).filter((e) => e.path !== norm);
    if (remaining.length === 0) {
      rmSync(targetJson, { force: true });
    } else {
      writeFileSync(targetJson, `${JSON.stringify(remaining, null, 2)}\n`, "utf8");
    }
  }
}

export function cleanupLeftoverPlacedFiles(workDir: string, repoRoot: string): string[] {
  const removed: string[] = [];
  for (const placedFile of getPlacedPaths(workDir)) {
    const entries = readPlacedEntries(placedFile);
    for (const entry of entries) {
      try {
        const safeRel = toRepoPath(entry.path, repoRoot);
        if (
          !checkCommitPath(safeRel).ok ||
          !isSafeRealPathInsideRoot(safeRel, repoRoot, { allowMissingLeaf: true, requireRegularFileIfExists: true })
        ) {
          continue;
        }
        const abs = path.join(repoRoot, safeRel);
        if (existsSync(abs)) {
          rmSync(abs, { force: true });
          removed.push(safeRel);
        }
      } catch {
        // Ignore unsafe/invalid recorded path
      }
    }
    if (existsSync(placedFile)) {
      rmSync(placedFile, { force: true });
    }
  }
  return removed;
}
