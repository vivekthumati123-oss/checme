import { EXIT_CODES, StageError } from "../../contracts";
import { runCommand } from "../../exec/exec";
import { toRepoPath } from "../paths";
import { DIFF_FLAGS } from "./range";

function unquoteGitPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return trimmed;
  }
  const inner = trimmed.slice(1, -1);
  return inner.replace(/\\(["\\tnr])/g, (_, esc: string) => {
    switch (esc) {
      case "t":
        return "\t";
      case "n":
        return "\n";
      case "r":
        return "\r";
      default:
        return esc;
    }
  });
}

function stripDiffPrefix(raw: string, prefix: "a/" | "b/"): string {
  const unquoted = unquoteGitPath(raw);
  return unquoted.startsWith(prefix) ? unquoted.slice(prefix.length) : unquoted;
}

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse `git diff --unified=0` output into `{ [repoPath]: sortedUniqueChangedLines }`.
 * Pure deletion hunks (`+c,0`) contribute zero changed lines. Binary and deleted files are ignored.
 */
export function parseUnifiedDiff(diffText: string): Record<string, number[]> {
  const fileLineSets = new Map<string, Set<number>>();
  const lines = diffText.replace(/\r\n/g, "\n").split("\n");

  let currentPath: string | null = null;
  let isDeleted = false;
  let isBinary = false;

  const ensureFile = (p: string): void => {
    if (!fileLineSets.has(p)) {
      fileLineSets.set(p, new Set<number>());
    }
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      currentPath = null;
      isDeleted = false;
      isBinary = false;
      const match = /^diff --git ("[^"]+"|\S+) ("[^"]+"|\S+)/.exec(line);
      if (match?.[2]) {
        currentPath = stripDiffPrefix(match[2], "b/");
      }
      continue;
    }

    if (line.startsWith("rename to ")) {
      currentPath = unquoteGitPath(line.slice("rename to ".length)).replace(/^\.\//, "");
      continue;
    }

    if (line === "+++ /dev/null" || line.startsWith("deleted file mode ")) {
      isDeleted = true;
      if (currentPath) {
        fileLineSets.delete(currentPath);
      }
      currentPath = null;
      continue;
    }

    if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      isBinary = true;
      if (currentPath) {
        fileLineSets.delete(currentPath);
      }
      continue;
    }

    if (line.startsWith("+++ b/")) {
      currentPath = unquoteGitPath(line.slice("+++ b/".length));
      if (!isDeleted && !isBinary && currentPath) {
        ensureFile(currentPath);
      }
      continue;
    }

    if (line.startsWith("+++ ") && !line.startsWith("+++ /dev/null")) {
      currentPath = stripDiffPrefix(line.slice(4), "b/");
      if (!isDeleted && !isBinary && currentPath) {
        ensureFile(currentPath);
      }
      continue;
    }

    if (currentPath && !isDeleted && !isBinary && line.startsWith("@@ ")) {
      ensureFile(currentPath);
      const match = HUNK_HEADER_RE.exec(line);
      if (match) {
        const startLine = Number.parseInt(match[1] ?? "0", 10);
        const count = match[2] !== undefined ? Number.parseInt(match[2], 10) : 1;
        if (count > 0 && startLine > 0) {
          const set = fileLineSets.get(currentPath)!;
          for (let ln = startLine; ln < startLine + count; ln += 1) {
            set.add(ln);
          }
        }
      }
    }
  }

  const result: Record<string, number[]> = {};
  for (const [filePath, set] of fileLineSets.entries()) {
    result[filePath] = [...set].sort((a, b) => a - b);
  }
  return result;
}

export async function getDiffChangedRanges(params: {
  repoRoot: string;
  baseSha: string;
  headSha: string;
}): Promise<Record<string, number[]>> {
  const res = await runCommand("git", ["diff", ...DIFF_FLAGS, `${params.baseSha}...${params.headSha}`], {
    cwd: params.repoRoot,
  });
  if (res.exitCode !== 0) {
    throw new StageError(
      `git diff failed (exit ${res.exitCode}): ${res.stderr.trim() || res.all.trim()}`,
      EXIT_CODES.INTERNAL,
      "prepare",
      "git_diff_failed",
    );
  }
  const raw = parseUnifiedDiff(res.stdout);
  const normalized: Record<string, number[]> = {};
  for (const [p, lines] of Object.entries(raw)) {
    const repoPath = toRepoPath(p, params.repoRoot);
    normalized[repoPath] = lines;
  }
  return normalized;
}

export async function getLocalGitDiff(params: {
  repoRoot: string;
  gitArgs: readonly string[];
}): Promise<Record<string, number[]>> {
  const res = await runCommand("git", ["diff", ...DIFF_FLAGS, ...params.gitArgs], { cwd: params.repoRoot });
  if (res.exitCode !== 0) {
    throw new StageError(
      `git diff failed (exit ${res.exitCode}): ${res.stderr.trim() || res.all.trim()}`,
      EXIT_CODES.INTERNAL,
      "local",
      "git_diff_failed",
    );
  }
  const raw = parseUnifiedDiff(res.stdout);
  const normalized: Record<string, number[]> = {};
  for (const [p, lines] of Object.entries(raw)) {
    const repoPath = toRepoPath(p, params.repoRoot);
    normalized[repoPath] = lines;
  }
  return normalized;
}
