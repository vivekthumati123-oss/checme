import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

import { EXIT_CODES, StageError } from "../contracts";

export function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

function isSameOrSubpath(target: string, root: string): boolean {
  const normTarget = normalizeSlashes(path.resolve(target)).replace(/\/+$/, "");
  const normRoot = normalizeSlashes(path.resolve(root)).replace(/\/+$/, "");
  if (process.platform === "win32") {
    const tLower = normTarget.toLowerCase();
    const rLower = normRoot.toLowerCase();
    return tLower === rLower || tLower.startsWith(`${rLower}/`);
  }
  return normTarget === normRoot || normTarget.startsWith(`${normRoot}/`);
}

function stripRootPrefix(absPath: string, rootPath: string): string | null {
  const normAbs = normalizeSlashes(absPath);
  const normRoot = normalizeSlashes(path.resolve(rootPath)).replace(/\/+$/, "");
  if (process.platform === "win32") {
    if (normAbs.toLowerCase() === normRoot.toLowerCase()) return "";
    if (normAbs.toLowerCase().startsWith(`${normRoot.toLowerCase()}/`)) {
      return normAbs.slice(normRoot.length + 1);
    }
    return null;
  }
  if (normAbs === normRoot) return "";
  if (normAbs.startsWith(`${normRoot}/`)) {
    return normAbs.slice(normRoot.length + 1);
  }
  return null;
}

/**
 * Verify that `targetPath` has no symlink segments (including dangling leaf symlinks)
 * and resolves inside `realRoot`.
 */
export function isSafeRealPathInsideRoot(
  targetPath: string,
  rootDir: string,
  opts: { allowMissingLeaf?: boolean; requireRegularFileIfExists?: boolean } = {},
): boolean {
  let realRoot: string;
  try {
    realRoot = realpathSync(rootDir);
  } catch {
    return false;
  }
  const absRoot = path.resolve(rootDir);
  const absTarget = path.resolve(rootDir, targetPath);
  const rel = path.relative(absRoot, absTarget);
  if (!rel || rel === "." || rel.startsWith("..") || path.isAbsolute(rel)) {
    return false;
  }
  const parts = normalizeSlashes(rel).split("/").filter(Boolean);
  let cur = absRoot;
  let deepestExisting = absRoot;
  for (let i = 0; i < parts.length; i += 1) {
    cur = path.join(cur, parts[i]!);
    const isLeaf = i === parts.length - 1;
    try {
      const st = lstatSync(cur);
      if (st.isSymbolicLink()) return false;
      if (!isLeaf && !st.isDirectory()) return false;
      if (isLeaf && opts.requireRegularFileIfExists && !st.isFile()) return false;
      deepestExisting = cur;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT" && opts.allowMissingLeaf) {
        break;
      }
      return false;
    }
  }
  try {
    return isSameOrSubpath(realpathSync(deepestExisting), realRoot);
  } catch {
    return false;
  }
}

export interface NormalizePathOptions {
  copyRoot?: string;
  workingDirectory?: string;
}

/**
 * Single path normalizer (X6).
 * Converts any absolute/relative/Windows/POSIX path or disposable-copy path
 * to a canonical repo-root-relative path using `/` separators.
 */
export function toRepoPath(inputPath: string, repoRoot: string, opts: NormalizePathOptions = {}): string {
  const trimmed = inputPath.trim();
  if (trimmed.length === 0) {
    throw new StageError("Empty path is not allowed.", EXIT_CODES.POLICY_OR_HASH, "prepare", "path_violation");
  }
  if (trimmed.includes("\0")) {
    throw new StageError("NUL byte in path is not allowed.", EXIT_CODES.POLICY_OR_HASH, "prepare", "path_violation");
  }

  const slashNormalized = normalizeSlashes(trimmed);
  if (slashNormalized.split("/").includes("..")) {
    throw new StageError(
      `Path traversal '..' is not allowed: "${inputPath}"`,
      EXIT_CODES.POLICY_OR_HASH,
      "prepare",
      "path_violation",
    );
  }

  // Strip disposable copy root first (e.g., C:\Users\...\Temp\unit-agent-val-xyz\packages\app\src\a.ts
  // or /tmp/unit-agent-val-xyz/src/a.ts).
  const isAbsLike = path.posix.isAbsolute(slashNormalized) || /^[A-Za-z]:/.test(slashNormalized);
  if (isAbsLike && opts.copyRoot) {
    const strippedCopy = stripRootPrefix(slashNormalized, opts.copyRoot);
    if (strippedCopy !== null) {
      const cleaned = cleanRepoRelative(strippedCopy);
      if (!cleaned) {
        throw new StageError("Empty path is not allowed.", EXIT_CODES.POLICY_OR_HASH, "prepare", "path_violation");
      }
      return cleaned;
    }
  }

  if (isAbsLike) {
    const strippedRepo = stripRootPrefix(slashNormalized, repoRoot);
    if (strippedRepo !== null) {
      const cleaned = cleanRepoRelative(strippedRepo);
      if (!cleaned) {
        throw new StageError("Empty path is not allowed.", EXIT_CODES.POLICY_OR_HASH, "prepare", "path_violation");
      }
      return cleaned;
    }

    // Handle POSIX paths stored in coverage reports generated inside Windows/POSIX copy roots.
    throw new StageError(
      `Path "${inputPath}" is outside repository root "${repoRoot}".`,
      EXIT_CODES.POLICY_OR_HASH,
      "prepare",
      "path_violation",
    );
  }

  let rel = cleanRepoRelative(slashNormalized);
  const wd = opts.workingDirectory ? cleanRepoRelative(normalizeSlashes(opts.workingDirectory)) : "";
  if (wd && wd !== "." && rel !== wd && !rel.startsWith(`${wd}/`)) {
    rel = cleanRepoRelative(`${wd}/${rel}`);
  }
  if (!rel) {
    throw new StageError("Empty path is not allowed.", EXIT_CODES.POLICY_OR_HASH, "prepare", "path_violation");
  }

  const resolved = path.resolve(repoRoot, rel);
  if (!isSameOrSubpath(resolved, repoRoot)) {
    throw new StageError(
      `Resolved path escapes repository root: "${inputPath}"`,
      EXIT_CODES.POLICY_OR_HASH,
      "prepare",
      "path_violation",
    );
  }

  return cleanRepoRelative(rel);
}

/**
 * Convert a repo-root-relative path into a path relative to `workingDirectory`.
 */
export function fromRepoPath(repoRelPath: string, workingDirectory = "."): string {
  const normPath = cleanRepoRelative(normalizeSlashes(repoRelPath));
  const normWd = cleanRepoRelative(normalizeSlashes(workingDirectory));
  if (!normWd || normWd === ".") return normPath;
  if (normPath === normWd) return ".";
  if (normPath.startsWith(`${normWd}/`)) {
    return normPath.slice(normWd.length + 1);
  }
  return normPath;
}

export function cleanRepoRelative(rel: string): string {
  const slashed = rel.replace(/\\/g, "/").replace(/\/+/g, "/");
  const collapsed = path.posix.normalize(slashed);
  if (collapsed === ".") return "";
  return collapsed
    .replace(/^\/+/, "")
    .replace(/^(?:\.\/)+/, "")
    .replace(/\/+$/, "");
}
