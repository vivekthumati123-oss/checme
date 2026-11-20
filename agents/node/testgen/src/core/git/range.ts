import { EXIT_CODES, StageError } from "../../contracts";
import { runCommand } from "../../exec/exec";

export interface DiffRange {
  baseSha: string;
  headSha: string;
  mergeBase: string;
}

export interface PullRequestEventLike {
  pull_request?: {
    base?: { sha?: string };
    head?: { sha?: string };
  };
}

export const DIFF_FLAGS = [
  "--unified=0",
  "--no-color",
  "--no-ext-diff",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "--find-renames",
  "--diff-filter=AMR",
] as const;

export async function requireCommit(sha: string, repoRoot: string): Promise<void> {
  const cleanSha = sha.trim();
  if (!cleanSha || cleanSha.startsWith("-")) {
    throw new StageError(`Invalid commit ref "${sha}".`, EXIT_CODES.CONFIG_OR_INPUT, "guard", "invalid_diff_sha");
  }
  const res = await runCommand("git", ["cat-file", "-e", `${cleanSha}^{commit}`], { cwd: repoRoot });
  if (res.exitCode !== 0) {
    throw new StageError(
      `Commit "${sha}" not found; the checkout needs fetch-depth: 0.`,
      EXIT_CODES.CONFIG_OR_INPUT,
      "guard",
      "shallow_clone_or_missing_commit",
    );
  }
}

/**
 * Single authoritative diff range resolver (F1). Never falls back to any moving branch or guessed ancestor.
 */
export async function resolveDiffRange(params: {
  repoRoot: string;
  baseSha?: string;
  headSha?: string;
  event?: PullRequestEventLike | null;
}): Promise<DiffRange> {
  const baseSha = params.baseSha?.trim() || params.event?.pull_request?.base?.sha?.trim();
  const headSha = params.headSha?.trim() || params.event?.pull_request?.head?.sha?.trim();

  if (!baseSha || !headSha) {
    throw new StageError(
      "PR base/head SHA not found. Run on a pull_request event or set UA_BASE_SHA and UA_HEAD_SHA.",
      EXIT_CODES.CONFIG_OR_INPUT,
      "guard",
      "missing_diff_sha",
    );
  }

  await requireCommit(baseSha, params.repoRoot);
  await requireCommit(headSha, params.repoRoot);

  const mbRes = await runCommand("git", ["merge-base", baseSha, headSha], { cwd: params.repoRoot });
  const mergeBase = mbRes.stdout.trim();
  if (mbRes.exitCode !== 0 || !mergeBase) {
    throw new StageError(
      "Unable to find merge-base between base and head commits; the checkout needs fetch-depth: 0.",
      EXIT_CODES.CONFIG_OR_INPUT,
      "guard",
      "shallow_clone_no_merge_base",
    );
  }

  return { baseSha, headSha, mergeBase };
}
