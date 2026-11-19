import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "../config";
import { EXIT_CODES, StageError, type GitHubClientLike, type LoggerLike, type UnitAgentConfig } from "../contracts";
import { runCommand } from "../exec/exec";
import { writeGitHubOutput, writeStageStatus } from "../telemetry";

export type GuardSkipReason =
  | "disabled"
  | "not_pull_request"
  | "fork_pr"
  | "draft_pr"
  | "skip_label"
  | "bot_pr"
  | "skip_commit_message"
  | "commit_loop"
  | "ok";

export interface PullRequestEventPayload {
  action?: string;
  number?: number;
  repository?: {
    full_name?: string;
    name?: string;
    owner?: { login?: string };
  };
  sender?: {
    login?: string;
    type?: string;
  };
  pull_request?: {
    number?: number;
    draft?: boolean;
    head?: {
      sha?: string;
      ref?: string;
      repo?: { full_name?: string } | null;
    };
    base?: {
      sha?: string;
      ref?: string;
      repo?: { full_name?: string } | null;
    };
    user?: {
      login?: string;
      type?: string;
    };
    labels?: Array<{ name?: string }>;
    head_commit?: { message?: string };
  };
  head_commit?: { message?: string };
}

export interface GuardResult {
  proceed: boolean;
  reason: GuardSkipReason;
  mode: "report" | "propose";
  pr: number;
  baseSha: string;
  headSha: string;
  headRef: string;
  repoFullName: string;
}

export interface RunGuardOptions {
  repoRoot: string;
  workDir: string;
  configPath?: string;
  config?: UnitAgentConfig;
  eventPath?: string;
  eventPayload?: PullRequestEventPayload;
  github?: GitHubClientLike;
  headCommitMessage?: string;
  logger?: LoggerLike;
  writeOutputs?: boolean;
}

export const BOT_LOOP_PREFIXES = ["test(unit-agent):", "chore(unit-agent):"];
export const LOOP_COMMIT_MARKERS = ["[unit-agent]"];
export const SKIP_COMMIT_MARKERS = ["[skip unit-agent]", "[unit-agent skip]"];
export const RUN_OPT_IN_LABEL = "unit-agent:run";
export const SKIP_LABEL = "unit-agent:skip";

export async function runGuard(opts: RunGuardOptions): Promise<GuardResult> {
  let payload = opts.eventPayload;
  if (!payload) {
    const resolvedEventPath = opts.eventPath ?? process.env.GITHUB_EVENT_PATH;
    if (!resolvedEventPath) {
      throw new StageError(
        "guard requires --event or GITHUB_EVENT_PATH when no eventPayload is provided.",
        EXIT_CODES.CONFIG_OR_INPUT,
        "guard",
        "missing_event_payload",
      );
    }
    const raw = readFileSync(path.resolve(resolvedEventPath), "utf8");
    payload = JSON.parse(raw) as PullRequestEventPayload;
  }

  const defaultMode: "report" | "propose" = opts.config?.mode ?? "report";

  if (process.env.UNIT_AGENT_ENABLED?.trim().toLowerCase() === "false") {
    const result: GuardResult = {
      proceed: false,
      reason: "disabled",
      mode: defaultMode,
      pr: payload.pull_request?.number ?? payload.number ?? 0,
      baseSha: payload.pull_request?.base?.sha ?? "",
      headSha: payload.pull_request?.head?.sha ?? "",
      headRef: payload.pull_request?.head?.ref ?? "",
      repoFullName: payload.repository?.full_name ?? process.env.GITHUB_REPOSITORY ?? "",
    };
    finalizeGuardOutputs(opts, result);
    return result;
  }

  const prObj = payload.pull_request;
  if (!prObj) {
    const result: GuardResult = {
      proceed: false,
      reason: "not_pull_request",
      mode: defaultMode,
      pr: 0,
      baseSha: "",
      headSha: "",
      headRef: "",
      repoFullName: payload.repository?.full_name ?? process.env.GITHUB_REPOSITORY ?? "",
    };
    finalizeGuardOutputs(opts, result);
    return result;
  }

  const repoFullName =
    prObj.base?.repo?.full_name ?? payload.repository?.full_name ?? process.env.GITHUB_REPOSITORY ?? "";
  const [owner = "", repoName = ""] = repoFullName.split("/");
  const prNum = prObj.number ?? payload.number ?? 0;

  let headRepoFullName = prObj.head?.repo?.full_name ?? "";
  const baseSha = prObj.base?.sha ?? "";
  let headSha = prObj.head?.sha ?? "";
  let headRef = prObj.head?.ref ?? "";
  let draft = Boolean(prObj.draft);
  let authorLogin = prObj.user?.login ?? payload.sender?.login ?? "";
  let authorType = prObj.user?.type ?? payload.sender?.type ?? "";
  let labels = (prObj.labels ?? []).map((l) => l.name ?? "").filter(Boolean);
  let headCommitMessage = opts.headCommitMessage ?? prObj.head_commit?.message ?? payload.head_commit?.message ?? "";

  if (opts.github && owner && repoName && prNum > 0) {
    const livePr = await opts.github.getPullRequest(owner, repoName, prNum);
    headRepoFullName = livePr.headRepoFullName;
    headSha = livePr.headSha || headSha;
    headRef = livePr.headRef || headRef;
    draft = livePr.draft;
    authorLogin = livePr.authorLogin || authorLogin;
    authorType = livePr.authorType || authorType;
    labels = livePr.labels;
    if (!opts.headCommitMessage && livePr.headCommitMessage) {
      headCommitMessage = livePr.headCommitMessage;
    }
  }

  if (!baseSha || !headSha) {
    throw new StageError(
      "guard requires pull_request.base.sha and pull_request.head.sha.",
      EXIT_CODES.CONFIG_OR_INPUT,
      "guard",
      "missing_pr_shas",
    );
  }

  const baseRepoFullName = prObj.base?.repo?.full_name ?? repoFullName;
  const isFork = !headRepoFullName || headRepoFullName.toLowerCase() !== baseRepoFullName.toLowerCase();
  if (isFork) {
    const result: GuardResult = {
      proceed: false,
      reason: "fork_pr",
      mode: defaultMode,
      pr: prNum,
      baseSha,
      headSha,
      headRef,
      repoFullName,
    };
    opts.logger?.info({ proceed: false, reason: "fork_pr", pr: prNum }, "Guard blocked fork PR");
    finalizeGuardOutputs(opts, result);
    return result;
  }

  // Only load repo config after verifying the PR is enabled, non-fork, and not a fork checkout
  const loadedCfg = opts.config ?? loadConfig(opts.repoRoot, opts.configPath).config;

  if (!headCommitMessage && !headSha.startsWith("-") && opts.repoRoot && existsSync(opts.repoRoot)) {
    try {
      const logRes = await runCommand("git", ["log", "-1", "--format=%B", headSha], {
        cwd: opts.repoRoot,
        config: loadedCfg,
        timeoutMs: 10_000,
      });
      if (logRes.exitCode === 0 && logRes.stdout.trim()) {
        headCommitMessage = logRes.stdout.trim();
      }
    } catch {
      // Best-effort offline commit message lookup
    }
  }

  const hasRunLabel = labels.includes(RUN_OPT_IN_LABEL);
  const hasSkipLabel = labels.includes(SKIP_LABEL);
  const isBot = authorType === "Bot" || authorLogin.endsWith("[bot]");
  const msgLower = headCommitMessage.toLowerCase();
  const isLoop =
    BOT_LOOP_PREFIXES.some((prefix) => msgLower.trimStart().startsWith(prefix)) ||
    LOOP_COMMIT_MARKERS.some((marker) => msgLower.includes(marker));
  const hasSkipMsg = SKIP_COMMIT_MARKERS.some((marker) => msgLower.includes(marker));

  let reason: GuardSkipReason = "ok";
  if (isLoop) {
    reason = "commit_loop";
  } else if (hasSkipLabel) {
    reason = "skip_label";
  } else if (hasSkipMsg) {
    reason = "skip_commit_message";
  } else if (draft && !hasRunLabel) {
    reason = "draft_pr";
  } else if (isBot && !hasRunLabel) {
    reason = "bot_pr";
  }

  const proceed = reason === "ok";
  const result: GuardResult = {
    proceed,
    reason,
    mode: loadedCfg.mode,
    pr: prNum,
    baseSha,
    headSha,
    headRef,
    repoFullName,
  };

  opts.logger?.info({ proceed, reason, pr: prNum, mode: loadedCfg.mode }, "Guard evaluated PR eligibility");
  finalizeGuardOutputs(opts, result);
  return result;
}

function finalizeGuardOutputs(opts: RunGuardOptions, result: GuardResult): void {
  writeStageStatus(opts.workDir, {
    stage: "prepare",
    status: result.proceed ? "ok" : "skipped",
    reason: result.reason,
  });

  if (opts.writeOutputs !== false) {
    writeGitHubOutput({
      proceed: String(result.proceed),
      reason: result.reason,
      mode: result.mode,
      pr: result.pr,
      base_sha: result.baseSha,
      head_sha: result.headSha,
      head_ref: result.headRef,
      status: result.proceed ? "ok" : "skipped",
    });
  }
}
