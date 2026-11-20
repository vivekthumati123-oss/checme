import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { EXIT_CODES, StageError, type UnitAgentConfig } from "../../contracts";
import { cleanRepoRelative, isSafeRealPathInsideRoot, normalizeSlashes } from "../../core/paths";

export interface ValidationWorkspace {
  root: string;
  isCopy: boolean;
  cleanup: () => void;
}

const LINK_COPY_DIRS = new Set(["node_modules", ".venv", "venv"]);

const SKIP_COPY_DIRS = new Set([
  ".git",
  ".unit-agent",
  "node_modules",
  ".venv",
  "venv",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".gradle",
]);

function measureCopyBytes(dirAbs: string, maxBytes: number): number {
  let total = 0;
  const walk = (cur: string): void => {
    if (total > maxBytes) return;
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (SKIP_COPY_DIRS.has(ent.name)) continue;
      const full = path.join(cur, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile()) {
        try {
          total += statSync(full).size;
        } catch {
          // ignore race
        }
      }
      if (total > maxBytes) return;
    }
  };
  walk(dirAbs);
  return total;
}

function copyFilteredTree(srcRoot: string, destRoot: string): void {
  const linkDirs: string[] = [];

  const copyRec = (srcCur: string, destCur: string): void => {
    mkdirSync(destCur, { recursive: true });
    const entries = readdirSync(srcCur, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      if (!LINK_COPY_DIRS.has(ent.name) && SKIP_COPY_DIRS.has(ent.name)) continue;
      const srcPath = path.join(srcCur, ent.name);
      const destPath = path.join(destCur, ent.name);

      if (LINK_COPY_DIRS.has(ent.name)) {
        if (ent.isDirectory()) {
          linkDirs.push(cleanRepoRelative(normalizeSlashes(path.relative(srcRoot, srcPath))));
        }
        continue;
      }

      if (ent.isDirectory()) {
        copyRec(srcPath, destPath);
      } else if (ent.isFile()) {
        cpSync(srcPath, destPath);
      }
    }
  };

  copyRec(srcRoot, destRoot);

  const linkType: "junction" | "dir" = process.platform === "win32" ? "junction" : "dir";
  for (const rel of linkDirs) {
    if (!rel || !isSafeRealPathInsideRoot(rel, srcRoot)) continue;
    const srcTarget = path.join(srcRoot, rel);
    const destLink = path.join(destRoot, rel);
    if (!existsSync(srcTarget)) continue;
    try {
      const st = lstatSync(srcTarget);
      if (st.isSymbolicLink() || !st.isDirectory()) continue;
      if (existsSync(destLink)) {
        lstatSync(destLink);
        continue;
      }
      mkdirSync(path.dirname(destLink), { recursive: true });
      symlinkSync(srcTarget, destLink, linkType);
    } catch {
      // Fallback if link creation fails (rare permission case)
    }
  }
}

export function prepareValidationWorkspace(
  repoRoot: string,
  config: UnitAgentConfig,
  stage: "validate1" | "validate2" | "local" = "validate1",
): ValidationWorkspace {
  if (config.validate.workspace === "inplace") {
    return {
      root: repoRoot,
      isCopy: false,
      cleanup: () => undefined,
    };
  }

  const maxBytes = config.validate.maxCopyMB * 1024 * 1024;
  const measured = measureCopyBytes(repoRoot, maxBytes + 1);
  if (measured > maxBytes) {
    throw new StageError(
      `Repository copy size exceeds validate.maxCopyMB (${config.validate.maxCopyMB} MB). Increase limits or switch validate.workspace: inplace.`,
      EXIT_CODES.INTERNAL,
      stage === "local" ? "local" : stage,
      "sandbox_copy_failed",
    );
  }

  const copyRoot = mkdtempSync(path.join(os.tmpdir(), "ua-val-"));
  try {
    copyFilteredTree(repoRoot, copyRoot);
  } catch (err) {
    rmSync(copyRoot, { recursive: true, force: true });
    const msg = err instanceof Error ? err.message : String(err);
    throw new StageError(
      `Failed to prepare disposable validation workspace: ${msg}`,
      EXIT_CODES.INTERNAL,
      stage === "local" ? "local" : stage,
      "sandbox_copy_failed",
    );
  }

  let canonicalCopyRoot = copyRoot;
  try {
    canonicalCopyRoot = realpathSync.native ? realpathSync.native(copyRoot) : realpathSync(copyRoot);
  } catch {
    try {
      canonicalCopyRoot = realpathSync(copyRoot);
    } catch {
      canonicalCopyRoot = copyRoot;
    }
  }

  return {
    root: canonicalCopyRoot,
    isCopy: true,
    cleanup: () => {
      try {
        rmSync(canonicalCopyRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        // Best-effort cleanup on Windows handles
      }
    },
  };
}
