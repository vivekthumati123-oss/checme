import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  ARTIFACTS,
  EXIT_CODES,
  FinalSchema,
  StageError,
  type Final,
  type GitHubClientLike,
  type LoggerLike,
  type UnitAgentConfig,
} from "../contracts";
import { hasProvenanceHeader } from "../config";
import { sha256Hex } from "../core/context";
import { checkCommitPath, safeHeredocDelimiter } from "../core/commit-paths";
import { cleanRepoRelative, isSafeRealPathInsideRoot, normalizeSlashes } from "../core/paths";
import { runStaticPolicyCheck } from "../core/policy";
import {
  buildCommitBody,
  buildCommitHeadline,
  buildCommentMarker,
  buildUnifiedNewFilePatch,
  DEFAULT_APPROVAL_ENVIRONMENT,
  inferLanguageForTestPath,
  isBranchProtectionOrPermissionError,
  isStaleHeadCommitError,
  upsertUnitAgentComment,
  verifyRunApprovals,
} from "../github";
import { loadOptionalResolvedConfig } from "./detect";
import { sanitizeForMarkdown, writeGitHubOutput, writeStageStatus, writeStepSummary } from "../telemetry";

export interface RunCommitOptions {
  workDir: string;
  repoRoot?: string;
  configPath?: string;
  config?: UnitAgentConfig;
  expectedHead: string;
  runId?: number;
  runUrl?: string;
  finalPath?: string;
  finalArtifact?: Final;
  github?: GitHubClientLike;
  commitGithub?: GitHubClientLike;
  approvalEnvironment?: string;
  approvalCheck?: "api" | "manual";
  requireApprovals?: boolean;
  dryRun?: boolean;
  logger?: LoggerLike;
  writeOutputs?: boolean;
}

export interface RunCommitResult {
  committed: boolean;
  commitSha?: string;
  approvers: string[];
  fallbackPatchPosted: boolean;
  reason: string;
}

async function postCommitFailureOrStatusComment(params: {
  github?: GitHubClientLike;
  dryRun?: boolean;
  owner: string;
  repo: string;
  pr: number;
  headSha: string;
  message: string;
}): Promise<void> {
  const body = `${buildCommentMarker(params.headSha)}\n## unit-agent: commit status\n\n${params.message}\n`;
  writeStepSummary(body);
  if (params.github && !params.dryRun && params.owner && params.repo && params.pr > 0) {
    try {
      await upsertUnitAgentComment({
        github: params.github,
        owner: params.owner,
        repo: params.repo,
        pr: params.pr,
        body,
      });
    } catch {
      // Never mask original exit reason if comment update fails
    }
  }
}

async function abortCommitPolicyOrHash(params: {
  github?: GitHubClientLike;
  dryRun?: boolean;
  workDir: string;
  owner: string;
  repo: string;
  pr: number;
  headSha: string;
  reason: string;
  message: string;
}): Promise<never> {
  await postCommitFailureOrStatusComment({
    github: params.github,
    dryRun: params.dryRun,
    owner: params.owner,
    repo: params.repo,
    pr: params.pr,
    headSha: params.headSha,
    message: params.message,
  });
  writeStageStatus(params.workDir, {
    stage: "commit",
    status: "error",
    code: EXIT_CODES.POLICY_OR_HASH,
    reason: params.reason,
  });
  throw new StageError(params.message, EXIT_CODES.POLICY_OR_HASH, "commit", params.reason);
}

export async function runCommit(opts: RunCommitOptions): Promise<RunCommitResult> {
  const finalDir = path.join(opts.workDir, ARTIFACTS.final.dir);
  const finalFile = opts.finalPath ?? path.join(finalDir, "final.json");

  let finalArtifact = opts.finalArtifact;
  if (!finalArtifact) {
    if (!existsSync(finalFile)) {
      throw new StageError(
        `Final artifact not found: "${finalFile}".`,
        EXIT_CODES.CONFIG_OR_INPUT,
        "commit",
        "missing_final",
      );
    }
    finalArtifact = FinalSchema.parse(JSON.parse(readFileSync(finalFile, "utf8")));
  }

  let config = opts.config;
  if (!config) {
    config = loadOptionalResolvedConfig({
      repoRoot: opts.repoRoot ?? opts.workDir,
      configPath: opts.configPath,
      fallbackDirs: [finalDir, path.dirname(finalFile), path.join(opts.workDir, ARTIFACTS.prepare.dir)],
    });
  }

  const [owner = "", repo = ""] = finalArtifact.repo.split("/");
  const envRepo = process.env.GITHUB_REPOSITORY?.trim();
  if (!owner || !repo || (envRepo && envRepo.toLowerCase() !== finalArtifact.repo.toLowerCase())) {
    await abortCommitPolicyOrHash({
      github: opts.github,
      dryRun: opts.dryRun,
      workDir: opts.workDir,
      owner: owner || envRepo?.split("/")[0] || "",
      repo: repo || envRepo?.split("/")[1] || "",
      pr: finalArtifact.pr,
      headSha: finalArtifact.headSha,
      reason: "repo_mismatch",
      message: `Commit aborted: \`final.json.repo\` (\`${sanitizeForMarkdown(finalArtifact.repo, 120)}\`) does not match repository context.`,
    });
  }

  if (finalArtifact.mode !== "propose" || finalArtifact.files.length === 0) {
    const reason = finalArtifact.mode !== "propose" ? "report_mode" : "no_files";
    writeStageStatus(opts.workDir, { stage: "commit", status: "skipped", reason });
    if (opts.writeOutputs !== false) {
      writeGitHubOutput({ committed: "false", status: "skipped" });
    }
    return { committed: false, approvers: [], fallbackPatchPosted: false, reason };
  }

  // 1a. Verify expected head matches finalArtifact.headSha -> exit 60
  if (finalArtifact.headSha !== opts.expectedHead) {
    const msg = `Commit aborted: \`final.json.headSha\` (\`${sanitizeForMarkdown(finalArtifact.headSha, 80)}\`) does not match \`--expected-head\` (\`${sanitizeForMarkdown(opts.expectedHead, 80)}\`).`;
    await postCommitFailureOrStatusComment({
      github: opts.github,
      dryRun: opts.dryRun,
      owner,
      repo,
      pr: finalArtifact.pr,
      headSha: finalArtifact.headSha,
      message: msg,
    });
    writeStageStatus(opts.workDir, {
      stage: "commit",
      status: "error",
      code: EXIT_CODES.POLICY_OR_HASH,
      reason: "head_sha_mismatch",
    });
    throw new StageError(msg, EXIT_CODES.POLICY_OR_HASH, "commit", "head_sha_mismatch");
  }

  // 1b. Re-verify SHA-256 and Gates 1-2 for every file from final/validated/
  const validatedRoot = path.join(finalDir, "validated");
  const additions: Array<{ path: string; contentsBase64: string; rawContent: string }> = [];
  const seenPaths = new Set<string>();
  for (const f of finalArtifact.files) {
    const normalizedPath = cleanRepoRelative(normalizeSlashes(f.path));
    if (
      normalizedPath !== normalizeSlashes(f.path) ||
      normalizedPath.startsWith("..") ||
      path.isAbsolute(f.path) ||
      normalizedPath.startsWith(".git/") ||
      normalizedPath.startsWith(".unit-agent/") ||
      seenPaths.has(normalizedPath.toLowerCase())
    ) {
      const msg = `Commit aborted: unsafe or duplicate test path \`${sanitizeForMarkdown(f.path, 160)}\` failed Gate 1.`;
      await postCommitFailureOrStatusComment({
        github: opts.github,
        dryRun: opts.dryRun,
        owner,
        repo,
        pr: finalArtifact.pr,
        headSha: finalArtifact.headSha,
        message: msg,
      });
      writeStageStatus(opts.workDir, {
        stage: "commit",
        status: "error",
        code: EXIT_CODES.POLICY_OR_HASH,
        reason: "path_violation",
      });
      throw new StageError(msg, EXIT_CODES.POLICY_OR_HASH, "commit", "path_violation");
    }
    seenPaths.add(normalizedPath.toLowerCase());

    const pathVerdict = checkCommitPath(normalizedPath);
    if (!pathVerdict.ok) {
      await abortCommitPolicyOrHash({
        github: opts.github,
        dryRun: opts.dryRun,
        workDir: opts.workDir,
        owner,
        repo,
        pr: finalArtifact.pr,
        headSha: finalArtifact.headSha,
        reason: "path_violation",
        message: `Commit aborted: test path \`${sanitizeForMarkdown(f.path, 160)}\` failed Gate 1 (${pathVerdict.reason}).`,
      });
    }

    if (!isSafeRealPathInsideRoot(normalizedPath, validatedRoot, { requireRegularFileIfExists: true })) {
      await abortCommitPolicyOrHash({
        github: opts.github,
        dryRun: opts.dryRun,
        workDir: opts.workDir,
        owner,
        repo,
        pr: finalArtifact.pr,
        headSha: finalArtifact.headSha,
        reason: "path_violation",
        message: `Commit aborted: validated snapshot path \`${sanitizeForMarkdown(normalizedPath, 160)}\` resolved via symlink or outside validated root.`,
      });
    }

    const validatedFile = path.join(validatedRoot, normalizedPath);
    if (!existsSync(validatedFile)) {
      await abortCommitPolicyOrHash({
        github: opts.github,
        dryRun: opts.dryRun,
        workDir: opts.workDir,
        owner,
        repo,
        pr: finalArtifact.pr,
        headSha: finalArtifact.headSha,
        reason: "hash_mismatch",
        message: `Commit aborted: validated snapshot missing for \`${sanitizeForMarkdown(normalizedPath, 160)}\`.`,
      });
    }

    const rawContent = readFileSync(validatedFile, "utf8");
    const actualSha = sha256Hex(rawContent);
    if (actualSha !== f.sha256) {
      await abortCommitPolicyOrHash({
        github: opts.github,
        dryRun: opts.dryRun,
        workDir: opts.workDir,
        owner,
        repo,
        pr: finalArtifact.pr,
        headSha: finalArtifact.headSha,
        reason: "hash_mismatch",
        message: `Commit aborted: SHA-256 mismatch for \`${sanitizeForMarkdown(normalizedPath, 160)}\`.`,
      });
    }

    if (config?.policy.provenanceHeader !== false && !hasProvenanceHeader(rawContent)) {
      await abortCommitPolicyOrHash({
        github: opts.github,
        dryRun: opts.dryRun,
        workDir: opts.workDir,
        owner,
        repo,
        pr: finalArtifact.pr,
        headSha: finalArtifact.headSha,
        reason: "policy_violation",
        message: `Commit aborted: \`${sanitizeForMarkdown(normalizedPath, 160)}\` lacks the unit-agent provenance header.`,
      });
    }

    const lang = inferLanguageForTestPath(normalizedPath);
    const policyRes = await runStaticPolicyCheck({
      language: lang,
      testPath: normalizedPath,
      content: rawContent,
      targetCount: Math.max(1, f.symbolIds.length),
      maxTestsPerSymbol: config?.limits.maxTestsPerSymbol ?? 6,
      extraBannedImports: config?.policy.extraBannedImports,
    });
    if (!policyRes.ok) {
      const detail = policyRes.violations.map((v) => `${v.rule}: ${v.message}`).join("; ");
      const msg = `Commit aborted: Gate 2 policy violation in \`${sanitizeForMarkdown(normalizedPath, 160)}\` (${sanitizeForMarkdown(detail, 240)}).`;
      await postCommitFailureOrStatusComment({
        github: opts.github,
        dryRun: opts.dryRun,
        owner,
        repo,
        pr: finalArtifact.pr,
        headSha: finalArtifact.headSha,
        message: msg,
      });
      writeStageStatus(opts.workDir, {
        stage: "commit",
        status: "error",
        code: EXIT_CODES.POLICY_OR_HASH,
        reason: "policy_violation",
      });
      throw new StageError(msg, EXIT_CODES.POLICY_OR_HASH, "commit", "policy_violation");
    }

    additions.push({
      path: normalizedPath,
      contentsBase64: Buffer.from(rawContent, "utf8").toString("base64"),
      rawContent,
    });
  }

  if (opts.dryRun || !opts.github) {
    writeStageStatus(opts.workDir, { stage: "commit", status: "ok", reason: "dry_run" });
    return { committed: false, approvers: [], fallbackPatchPosted: false, reason: "dry_run" };
  }

  // 2. Live PR head staleness & same-repo checks
  const prInfo = await opts.github.getPullRequest(owner, repo, finalArtifact.pr);
  if (!prInfo.headRepoFullName || prInfo.headRepoFullName.toLowerCase() !== prInfo.baseRepoFullName.toLowerCase()) {
    await abortCommitPolicyOrHash({
      github: opts.github,
      dryRun: opts.dryRun,
      workDir: opts.workDir,
      owner,
      repo,
      pr: finalArtifact.pr,
      headSha: finalArtifact.headSha,
      reason: "fork_pr",
      message: "Commit aborted: pull request originates from a fork or deleted repository.",
    });
  }
  if (prInfo.draft && !prInfo.labels.includes("unit-agent:run")) {
    await abortCommitPolicyOrHash({
      github: opts.github,
      dryRun: opts.dryRun,
      workDir: opts.workDir,
      owner,
      repo,
      pr: finalArtifact.pr,
      headSha: finalArtifact.headSha,
      reason: "draft_pr",
      message: "Commit aborted: pull request is now a draft without `unit-agent:run` opt-in.",
    });
  }
  if (prInfo.headSha !== opts.expectedHead) {
    const staleMsg = "PR changed after the tests were generated; push triggered a new run.";
    await postCommitFailureOrStatusComment({
      github: opts.github,
      dryRun: opts.dryRun,
      owner,
      repo,
      pr: finalArtifact.pr,
      headSha: finalArtifact.headSha,
      message: staleMsg,
    });
    writeStageStatus(opts.workDir, {
      stage: "commit",
      status: "soft_fail",
      code: EXIT_CODES.STALE_HEAD_OR_SOURCE,
      reason: "stale_head",
    });
    throw new StageError(staleMsg, EXIT_CODES.STALE_HEAD_OR_SOURCE, "commit", "stale_head");
  }

  // 3. Approvers check (honor environment prevent_self_review policy when only PR author approved)
  const numericRunId =
    opts.runId !== undefined ? Number(opts.runId) : process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : 0;
  const approvalEnvironment =
    opts.approvalEnvironment ??
    process.env.UA_APPROVAL_ENV ??
    process.env.UA_APPROVAL_ENVIRONMENT ??
    DEFAULT_APPROVAL_ENVIRONMENT;
  let approvers: string[] = [];
  if (opts.requireApprovals !== false) {
    const approvalOutcome = await verifyRunApprovals({
      github: opts.github,
      owner,
      repo,
      runId: numericRunId,
      prAuthorLogin: prInfo.authorLogin,
      environmentName: approvalEnvironment,
    });
    if (!approvalOutcome.ok) {
      const msg = `Commit blocked: ${approvalOutcome.reason ?? "missing valid non-author approval"}.`;
      await postCommitFailureOrStatusComment({
        github: opts.github,
        dryRun: opts.dryRun,
        owner,
        repo,
        pr: finalArtifact.pr,
        headSha: finalArtifact.headSha,
        message: msg,
      });
      writeStageStatus(opts.workDir, {
        stage: "commit",
        status: "error",
        code: EXIT_CODES.POLICY_OR_HASH,
        reason: "approval_bypass",
      });
      throw new StageError(msg, EXIT_CODES.POLICY_OR_HASH, "commit", "approval_bypass");
    }
    approvers = approvalOutcome.approvers;
  }

  const runUrl =
    opts.runUrl ??
    (numericRunId > 0 ? `https://github.com/${finalArtifact.repo}/actions/runs/${numericRunId}` : undefined);

  const commitClient = opts.commitGithub ?? opts.github;
  const headline = buildCommitHeadline(additions.length);
  const body = buildCommitBody({ runUrl, approvers });

  // 4. Atomic GraphQL createCommitOnBranch mutation (using commitClient, comments using opts.github)
  try {
    const { oid } = await commitClient.createCommitOnBranch({
      repositoryNameWithOwner: finalArtifact.repo,
      branchName: prInfo.headRef || finalArtifact.headRef,
      expectedHeadOid: opts.expectedHead,
      headline,
      body,
      additions: additions.map((a) => ({ path: a.path, contentsBase64: a.contentsBase64 })),
    });

    const approversDisplay = approvers.map((a) => `@&#8203;${sanitizeForMarkdown(a, 60)}`).join(", ") || "reviewer";
    const ciNote =
      config?.commit.auth === "pat"
        ? "Because `commit.auth: pat` was used, new CI runs triggered by this commit will skip re-running unit-agent via the `[unit-agent]` commit marker."
        : "With the default `GITHUB_TOKEN`, this push does **not** automatically trigger repository workflows; push an empty commit or re-run checks if required status checks remain pending.";

    await postCommitFailureOrStatusComment({
      github: opts.github,
      dryRun: opts.dryRun,
      owner,
      repo,
      pr: finalArtifact.pr,
      headSha: oid,
      message: `Committed \`${oid}\`; approved by ${approversDisplay}.\n\n${ciNote}`,
    });

    writeStageStatus(opts.workDir, { stage: "commit", status: "ok", reason: "committed" });
    if (opts.writeOutputs !== false) {
      writeGitHubOutput({ committed: "true", committed_sha: oid, status: "ok" });
    }
    opts.logger?.info({ commitSha: oid, approversCount: approvers.length }, "Committed generated unit tests.");
    return { committed: true, commitSha: oid, approvers, fallbackPatchPosted: false, reason: "committed" };
  } catch (err) {
    if (isStaleHeadCommitError(err)) {
      const staleMsg = "PR changed after the tests were generated; push triggered a new run.";
      await postCommitFailureOrStatusComment({
        github: opts.github,
        dryRun: opts.dryRun,
        owner,
        repo,
        pr: finalArtifact.pr,
        headSha: finalArtifact.headSha,
        message: staleMsg,
      });
      writeStageStatus(opts.workDir, {
        stage: "commit",
        status: "soft_fail",
        code: EXIT_CODES.STALE_HEAD_OR_SOURCE,
        reason: "stale_head",
      });
      throw new StageError(staleMsg, EXIT_CODES.STALE_HEAD_OR_SOURCE, "commit", "stale_head");
    }

    if (!isBranchProtectionOrPermissionError(err)) {
      throw err;
    }

    // 5. Branch protection / permission fallback: build patch deterministically from verified additions
    const patchDiff = buildUnifiedNewFilePatch(additions.map((a) => ({ path: a.path, content: a.rawContent })));

    const delim = safeHeredocDelimiter(patchDiff);
    const fallbackMsg = [
      `Could not push commit directly to \`${sanitizeForMarkdown(prInfo.headRef || finalArtifact.headRef, 120)}\` due to branch protection or permissions.`,
      "Apply the validated patch locally and push:",
      "",
      "```bash",
      `git apply <<'${delim}'`,
      patchDiff.trimEnd(),
      delim,
      "```",
    ].join("\n");

    await postCommitFailureOrStatusComment({
      github: opts.github,
      dryRun: opts.dryRun,
      owner,
      repo,
      pr: finalArtifact.pr,
      headSha: finalArtifact.headSha,
      message: `<details><summary>Patch to apply manually (branch protection blocked direct commit)</summary>\n\n${fallbackMsg}\n\n</details>`,
    });

    writeStageStatus(opts.workDir, {
      stage: "commit",
      status: "ok",
      reason: "branch_protection_fallback",
    });
    if (opts.writeOutputs !== false) {
      writeGitHubOutput({ committed: "false", fallback_patch_posted: "true", status: "ok" });
    }
    return {
      committed: false,
      approvers,
      fallbackPatchPosted: true,
      reason: "branch_protection_fallback",
    };
  }
}
