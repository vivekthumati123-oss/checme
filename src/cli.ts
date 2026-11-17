import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Command } from "commander";

import { loadConfig, runConfigCheck } from "./config";
import {
  ARTIFACTS,
  EXIT_CODES,
  ManifestSchema,
  PlanOutputSchema,
  StageError,
  StageStatusSchema,
  type ExitCode,
  type GitHubClientLike,
  type StageName,
} from "./contracts";
import { resolveDiffRange, type PullRequestEventLike } from "./core/git/range";
import { createGitHubClientsFromEnv } from "./github";
import {
  normalizeSummaryPaths,
  runInitChat,
  runLocalApply,
  runLocalDetect,
  runLocalDoctor,
  runLocalShow,
  runLocalStatus,
  runLocalValidate,
  serializeBoundedSummary,
} from "./local";
import { runBaseline } from "./stages/baseline";
import { runCommit } from "./stages/commit";
import { runDetect, loadOptionalResolvedConfig } from "./stages/detect";
import { runGenerate } from "./stages/generate";
import { runGuard, type PullRequestEventPayload } from "./stages/guard";
import { runInstall } from "./stages/install";
import { runNotice } from "./stages/notice";
import { runPlan } from "./stages/plan";
import { runPublish } from "./stages/publish";
import { runRepair } from "./stages/repair";
import { runValidate } from "./stages/validate";
import {
  mapErrorToStageStatus,
  maskStartupSecrets,
  resolveProcessExitCode,
  sanitizeOutput,
  writeGitHubOutput,
  writeStageStatus,
} from "./telemetry";

export interface GlobalOptions {
  config?: string;
  workDir: string;
  json?: boolean;
  strict?: boolean;
  offline?: boolean;
  repoRoot: string;
}

interface ParsedEventMeta {
  eventPath?: string;
  payload: (PullRequestEventPayload & PullRequestEventLike) | null;
  repoFullName?: string;
  prNumber?: number;
  baseSha?: string;
  headSha?: string;
}

interface CliTrackContext {
  stage: StageName | "local";
  repoRoot: string;
  workDir: string;
}

function resolvePaths(opts: GlobalOptions, track?: CliTrackContext): { repoRoot: string; workDir: string } {
  const repoRoot = path.resolve(opts.repoRoot);
  const workDir = path.isAbsolute(opts.workDir) ? opts.workDir : path.resolve(repoRoot, opts.workDir);
  if (track) {
    track.repoRoot = repoRoot;
    track.workDir = workDir;
  }
  return { repoRoot, workDir };
}

function readEventMeta(explicitEventPath?: string): ParsedEventMeta {
  const resolved = explicitEventPath ?? process.env.GITHUB_EVENT_PATH;
  if (!resolved || !existsSync(path.resolve(resolved))) {
    return {
      eventPath: explicitEventPath,
      payload: null,
      repoFullName: process.env.GITHUB_REPOSITORY || undefined,
    };
  }

  const raw = readFileSync(path.resolve(resolved), "utf8");
  const payload = JSON.parse(raw) as PullRequestEventPayload & PullRequestEventLike;
  const prObj = payload.pull_request;
  return {
    eventPath: resolved,
    payload,
    repoFullName:
      prObj?.base?.repo?.full_name ?? payload.repository?.full_name ?? (process.env.GITHUB_REPOSITORY || undefined),
    prNumber: prObj?.number ?? payload.number ?? undefined,
    baseSha: prObj?.base?.sha || undefined,
    headSha: prObj?.head?.sha || undefined,
  };
}

function stageDirName(stage: StageName): string {
  const map: Record<StageName, string> = {
    prepare: ARTIFACTS.prepare.dir,
    generate: ARTIFACTS.proposed.dir,
    validate1: ARTIFACTS.validate1.dir,
    repair: ARTIFACTS.repaired.dir,
    validate2: ARTIFACTS.validate2.dir,
    publish: ARTIFACTS.final.dir,
    commit: "commit",
  };
  return map[stage];
}

function hasAnyNoticeStatus(workDir: string): boolean {
  for (const dir of [
    ARTIFACTS.prepare.dir,
    ARTIFACTS.proposed.dir,
    ARTIFACTS.validate1.dir,
    ARTIFACTS.repaired.dir,
    ARTIFACTS.validate2.dir,
    ARTIFACTS.final.dir,
  ]) {
    const p = path.join(workDir, dir, "status.json");
    if (!existsSync(p)) continue;
    try {
      const parsed = StageStatusSchema.parse(JSON.parse(readFileSync(p, "utf8")));
      if (parsed.status !== "ok") return true;
    } catch {
      return true;
    }
  }

  const planPath = path.join(workDir, ARTIFACTS.prepare.dir, "plan.json");
  if (existsSync(planPath)) {
    try {
      const rawPlan = JSON.parse(readFileSync(planPath, "utf8")) as { skipped?: unknown };
      const parsed = PlanOutputSchema.safeParse(rawPlan);
      if (parsed.success) {
        if (parsed.data.skipped.length > 0) return true;
      } else if (Array.isArray(rawPlan?.skipped) && rawPlan.skipped.length > 0) {
        return true;
      }
    } catch {
      // ignore malformed optional plan
    }
  }

  const baselinePath = path.join(workDir, ARTIFACTS.prepare.dir, "baseline.json");
  if (existsSync(baselinePath)) {
    try {
      const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as { status?: unknown };
      if (baseline?.status === "red") return true;
    } catch {
      // ignore malformed optional baseline
    }
  }

  const manifestPath = path.join(workDir, ARTIFACTS.prepare.dir, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const rawManifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        files?: unknown;
        skipped?: unknown;
      };
      const parsed = ManifestSchema.safeParse(rawManifest);
      if (parsed.success) {
        if (parsed.data.files.length === 0 && parsed.data.skipped.length > 0) return true;
      } else if (
        Array.isArray(rawManifest?.files) &&
        rawManifest.files.length === 0 &&
        Array.isArray(rawManifest?.skipped) &&
        rawManifest.skipped.length > 0
      ) {
        return true;
      }
    } catch {
      // ignore malformed optional manifest
    }
  }

  return false;
}

function parsePositiveIntOption(raw: unknown, name: string, stage: StageName | "local"): number {
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new StageError(
      `Invalid ${name}: "${String(raw)}". Expected integer >= 1.`,
      EXIT_CODES.CONFIG_OR_INPUT,
      stage,
      "invalid_option",
    );
  }
  return n;
}

export function buildProgram(track?: CliTrackContext): Command {
  const program = new Command();

  program
    .name("unit-agent")
    .description("Diff-aware Unit Test Generation and Validation CLI (Spec v2.0)")
    .version("2.0.0")
    .option("--config <path>", "Path to .unit-agent.yml")
    .option("--work-dir <path>", "Working artifact directory", ".unit-agent")
    .option("--json", "Emit machine-readable JSON output")
    .option("--strict", "Fail with non-zero exit code in Actions instead of soft-failing")
    .option("--offline", "Disable all network calls and use offline behavior")
    .option("--repo-root <path>", "Repository root directory", process.cwd());

  const configCmd = program.command("config").description("Validate and inspect configuration");
  configCmd
    .command("check")
    .description("Validate .unit-agent.yml and print effective configuration summary")
    .action(() => {
      const opts = program.opts<GlobalOptions>();
      const { repoRoot } = resolvePaths(opts, track);
      const result = runConfigCheck(repoRoot, opts.config);
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else if (result.ok) {
        process.stdout.write(`OK: ${result.configPath}\n`);
        for (const warning of result.warnings) {
          process.stderr.write(`WARN: ${warning}\n`);
        }
        if (result.summary) {
          process.stdout.write(
            `Mode: ${result.summary.mode} | Languages: ${result.summary.enabledLanguages.join(", ")} | Workspace: ${result.summary.workspace}\n`,
          );
          for (const [lang, sample] of Object.entries(result.summary.sampleTestPaths)) {
            process.stdout.write(`  sample(${lang}): ${sample}\n`);
          }
        }
      } else {
        for (const err of result.errors) {
          process.stderr.write(`ERROR: ${err}\n`);
        }
      }
      if (!result.ok) {
        process.exitCode = EXIT_CODES.CONFIG_OR_INPUT;
      }
    });

  program
    .command("guard")
    .description("Validate PR safety, labels, fork policy, and permissions")
    .option("--event <path>", "Path to GitHub Actions event JSON")
    .action(async (cmdOpts: { event?: string }) => {
      if (track) track.stage = "prepare";
      const opts = program.opts<GlobalOptions>();
      const { repoRoot, workDir } = resolvePaths(opts, track);
      const github = opts.offline ? undefined : createGitHubClientsFromEnv().github;
      const result = await runGuard({
        repoRoot,
        workDir,
        configPath: opts.config,
        eventPath: cmdOpts.event,
        github,
      });
      writeGitHubOutput({ skip: String(!result.proceed) });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(`guard: proceed=${result.proceed} reason=${result.reason} mode=${result.mode}\n`);
      }
    });

  program
    .command("plan")
    .description("Select affected languages, build toolchains, and validate diff range")
    .option("--event <path>", "Path to GitHub Actions event JSON")
    .option("--base <sha>", "Base commit SHA")
    .option("--head <sha>", "Head commit SHA")
    .action(async (cmdOpts: { event?: string; base?: string; head?: string }) => {
      if (track) track.stage = "prepare";
      const opts = program.opts<GlobalOptions>();
      const { repoRoot, workDir } = resolvePaths(opts, track);
      const result = await runPlan({
        repoRoot,
        workDir,
        configPath: opts.config,
        eventPath: cmdOpts.event,
        baseSha: cmdOpts.base ?? process.env.UA_BASE_SHA,
        headSha: cmdOpts.head ?? process.env.UA_HEAD_SHA,
      });
      writeGitHubOutput({
        languages: JSON.stringify(result.plan.languages),
        toolchains: JSON.stringify(result.plan.toolchains),
      });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.plan, null, 2)}\n`);
      } else {
        process.stdout.write(
          `plan: languages=[${result.plan.languages.join(", ")}] base=${result.baseSha} head=${result.headSha}\n`,
        );
      }
    });

  program
    .command("install")
    .description("Restore dependencies and build project prior to validation")
    .option("--plan <path>", "Path to plan.json")
    .action(async (cmdOpts: { plan?: string }) => {
      if (track) track.stage = "prepare";
      const opts = program.opts<GlobalOptions>();
      const { repoRoot, workDir } = resolvePaths(opts, track);
      const outcomes = await runInstall({
        repoRoot,
        workDir,
        configPath: opts.config,
        planPath: cmdOpts.plan,
      });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(outcomes, null, 2)}\n`);
      } else {
        for (const o of outcomes) {
          process.stdout.write(`install(${o.language}): ran=${o.ran} exit=${o.exitCode} durationMs=${o.durationMs}\n`);
        }
      }
    });

  program
    .command("baseline")
    .description("Run baseline test suite with coverage prior to diff detection")
    .option("--plan <path>", "Path to plan.json")
    .action(async (cmdOpts: { plan?: string }) => {
      if (track) track.stage = "prepare";
      const opts = program.opts<GlobalOptions>();
      const { repoRoot, workDir } = resolvePaths(opts, track);
      const artifact = await runBaseline({
        repoRoot,
        workDir,
        configPath: opts.config,
        planPath: cmdOpts.plan,
      });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
      } else {
        process.stdout.write(
          `baseline: status=${artifact.status} patchCoveragePct=${artifact.patchCoveragePct ?? "null"}\n`,
        );
      }
    });

  program
    .command("detect")
    .description("Compute uncovered diff targets, AST symbols, and file contexts")
    .option("--base <sha>", "Base commit SHA")
    .option("--head <sha>", "Head commit SHA")
    .option("--event <path>", "Path to GitHub Actions event JSON")
    .option("--plan <path>", "Path to plan.json")
    .action(async (cmdOpts: { base?: string; head?: string; event?: string; plan?: string }) => {
      if (track) track.stage = "prepare";
      const opts = program.opts<GlobalOptions>();
      const { repoRoot, workDir } = resolvePaths(opts, track);
      const eventMeta = readEventMeta(cmdOpts.event);
      const range = await resolveDiffRange({
        repoRoot,
        baseSha: cmdOpts.base ?? process.env.UA_BASE_SHA ?? eventMeta.baseSha,
        headSha: cmdOpts.head ?? process.env.UA_HEAD_SHA ?? eventMeta.headSha,
        event: eventMeta.payload,
      });
      const manifest = await runDetect({
        repoRoot,
        workDir,
        configPath: opts.config,
        diffSource: { kind: "git-range", base: range.baseSha, head: range.headSha },
        runId: process.env.GITHUB_RUN_ID,
        repoFullName: eventMeta.repoFullName,
        prNumber: eventMeta.prNumber,
        baseSha: range.baseSha,
        headSha: range.headSha,
      });
      writeGitHubOutput({
        has_work: String(manifest.files.length > 0),
      });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
      } else {
        process.stdout.write(`detect: files=${manifest.files.length} skipped=${manifest.skipped.length}\n`);
      }
    });

  program
    .command("notice")
    .description("Record step summary and optional prepare notice artifact for skipped/failed runs")
    .option("--reason <reason>", "Explicit notice reason")
    .option("--event <path>", "Path to GitHub Actions event JSON")
    .option("--dry-run", "Render notice without calling GitHub API")
    .action(async (cmdOpts: { reason?: string; event?: string; dryRun?: boolean }) => {
      if (track) track.stage = "prepare";
      const opts = program.opts<GlobalOptions>();
      const { repoRoot, workDir } = resolvePaths(opts, track);
      const hasNotice = Boolean(cmdOpts.reason) || hasAnyNoticeStatus(workDir);
      if (!hasNotice) {
        writeGitHubOutput({ has_notice: "false" });
        if (opts.json) {
          process.stdout.write(`${JSON.stringify({ hasNotice: false }, null, 2)}\n`);
        }
        return;
      }
      let eventMeta: ParsedEventMeta = {
        eventPath: cmdOpts.event,
        payload: null,
        repoFullName: process.env.GITHUB_REPOSITORY || undefined,
      };
      try {
        eventMeta = readEventMeta(cmdOpts.event);
      } catch {
        // Missing or malformed event payload degrades cleanly for notice generation
      }
      let github: GitHubClientLike | undefined;
      if (!opts.offline && !cmdOpts.dryRun) {
        try {
          github = createGitHubClientsFromEnv().github;
        } catch {
          // Missing/invalid GITHUB_TOKEN degrades gracefully to GITHUB_STEP_SUMMARY + notice.md
          github = undefined;
        }
      }
      const markdown = await runNotice({
        workDir,
        repoRoot,
        repoFullName: eventMeta.repoFullName,
        prNumber: eventMeta.prNumber,
        reason: cmdOpts.reason,
        github,
        dryRun: Boolean(opts.offline || cmdOpts.dryRun),
      });
      const noticePath = path.join(workDir, ARTIFACTS.prepare.dir, "notice.md");
      mkdirSync(path.dirname(noticePath), { recursive: true });
      writeFileSync(noticePath, `${markdown}\n`, "utf8");
      writeGitHubOutput({ has_notice: "true" });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ hasNotice: true, noticePath }, null, 2)}\n`);
      } else {
        process.stdout.write(`notice: recorded ${noticePath}\n`);
      }
    });

  program
    .command("generate")
    .description("Generate proposed unit tests per file using Copilot SDK or fake LLM")
    .option("--manifest <path>", "Path to manifest.json")
    .option("--dry-run", "Prepare prompts without invoking the SDK")
    .option("--fake-llm <script>", "Path to deterministic fake LLM response script")
    .action(async (cmdOpts: { manifest?: string; dryRun?: boolean; fakeLlm?: string }) => {
      if (track) track.stage = "generate";
      const opts = program.opts<GlobalOptions>();
      const { repoRoot, workDir } = resolvePaths(opts, track);
      const fakeLlmPath = cmdOpts.fakeLlm ?? process.env.UA_FAKE_LLM;
      if (opts.offline && !cmdOpts.dryRun && !fakeLlmPath) {
        throw new StageError(
          "Cannot call live Copilot SDK under --offline without --dry-run or --fake-llm.",
          EXIT_CODES.CONFIG_OR_INPUT,
          "generate",
          "offline_sdk_blocked",
        );
      }
      const proposed = await runGenerate({
        repoRoot,
        workDir,
        configPath: opts.config,
        manifestPath: cmdOpts.manifest,
        dryRun: Boolean(cmdOpts.dryRun),
        fakeLlmPath,
      });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(proposed, null, 2)}\n`);
      } else {
        process.stdout.write(`generate: proposedFiles=${proposed.files.length}\n`);
      }
    });

  program
    .command("validate")
    .description("Run static policy gates and execute tests/coverage")
    .option("--attempt <n>", "Validation attempt number (1, 2, ...)", "1")
    .option("--phase <phase>", "Validation phase: static | run | all", "all")
    .option("--input <path>", "Path to proposed.json or proposed.repaired.json")
    .option("--proposed <path>", "Alias for --input")
    .option("--manifest <path>", "Path to manifest.json")
    .option("--local", "Run in local mode")
    .action(
      async (cmdOpts: {
        attempt?: string;
        phase: string;
        input?: string;
        proposed?: string;
        manifest?: string;
        local?: boolean;
      }) => {
        const attempt = parsePositiveIntOption(cmdOpts.attempt ?? "1", "--attempt", "validate1");
        const stage: StageName = attempt === 1 ? "validate1" : "validate2";
        if (track) track.stage = stage;
        if (cmdOpts.phase !== "static" && cmdOpts.phase !== "run" && cmdOpts.phase !== "all") {
          throw new StageError(
            `Invalid --phase "${cmdOpts.phase}". Expected static | run | all.`,
            EXIT_CODES.CONFIG_OR_INPUT,
            stage,
            "invalid_phase",
          );
        }
        const opts = program.opts<GlobalOptions>();
        const { repoRoot, workDir } = resolvePaths(opts, track);
        const result = await runValidate({
          repoRoot,
          workDir,
          configPath: opts.config,
          manifestPath: cmdOpts.manifest,
          proposedPath: cmdOpts.input ?? cmdOpts.proposed,
          phase: cmdOpts.phase,
          attempt,
          local: Boolean(cmdOpts.local),
          offline: Boolean(opts.offline),
        });
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
        } else {
          process.stdout.write(
            `validate(attempt=${attempt}, phase=${cmdOpts.phase}): files=${result.report.files.length}\n`,
          );
        }
      },
    );

  program
    .command("repair")
    .description("Attempt targeted repair on failing generated tests")
    .option("--failures <path>", "Path to failures.json")
    .option("--proposed <path>", "Path to proposed.json")
    .option("--dry-run", "Prepare repair prompts without invoking the SDK")
    .option("--fake-llm <script>", "Path to deterministic fake LLM response script")
    .action(async (cmdOpts: { failures?: string; proposed?: string; dryRun?: boolean; fakeLlm?: string }) => {
      if (track) track.stage = "repair";
      const opts = program.opts<GlobalOptions>();
      const { repoRoot, workDir } = resolvePaths(opts, track);
      const fakeLlmPath = cmdOpts.fakeLlm ?? process.env.UA_FAKE_LLM;
      if (opts.offline && !cmdOpts.dryRun && !fakeLlmPath) {
        throw new StageError(
          "Cannot call live Copilot SDK under --offline without --dry-run or --fake-llm.",
          EXIT_CODES.CONFIG_OR_INPUT,
          "repair",
          "offline_sdk_blocked",
        );
      }
      const repaired = await runRepair({
        repoRoot,
        workDir,
        configPath: opts.config,
        failuresPath: cmdOpts.failures,
        proposedPath: cmdOpts.proposed,
        dryRun: Boolean(cmdOpts.dryRun),
        fakeLlmPath,
      });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(repaired, null, 2)}\n`);
      } else {
        process.stdout.write(`repair: files=${repaired.files.length}\n`);
      }
    });

  program
    .command("publish")
    .description("Create final report and upsert PR summary comment")
    .option("--report <path>", "Path to report.json")
    .option("--final <path>", "Path to final.json")
    .option("--event <path>", "Path to GitHub Actions event JSON")
    .option("--dry-run", "Write final artifact without calling GitHub API")
    .action(async (cmdOpts: { report?: string; final?: string; event?: string; dryRun?: boolean }) => {
      if (track) track.stage = "publish";
      const opts = program.opts<GlobalOptions>();
      const { repoRoot, workDir } = resolvePaths(opts, track);
      const eventMeta = readEventMeta(cmdOpts.event);
      const github = opts.offline || cmdOpts.dryRun ? undefined : createGitHubClientsFromEnv().github;
      const approvalCheckRaw = process.env.UA_APPROVAL_CHECK;
      const approvalCheck = approvalCheckRaw === "manual" || approvalCheckRaw === "api" ? approvalCheckRaw : undefined;
      const res = await runPublish({
        repoRoot,
        workDir,
        configPath: opts.config,
        reportPath: cmdOpts.report,
        finalPath: cmdOpts.final,
        approvalEnvironment: process.env.UA_APPROVAL_ENV ?? process.env.UA_APPROVAL_ENVIRONMENT,
        approvalCheck,
        repoFullName: eventMeta.repoFullName,
        prNumber: eventMeta.prNumber,
        headSha: eventMeta.headSha,
        github,
        dryRun: Boolean(opts.offline || cmdOpts.dryRun),
      });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(res.finalArtifact, null, 2)}\n`);
      } else {
        process.stdout.write(
          `publish: acceptedFiles=${res.finalArtifact.files.length} mode=${res.finalArtifact.mode}\n`,
        );
      }
    });

  program
    .command("commit")
    .description("Re-verify approvals/hashes and commit generated tests to PR branch")
    .option("--expected-head <sha>", "Expected PR head SHA before committing")
    .option("--final <path>", "Path to final.json")
    .option("--dry-run", "Verify pre-conditions without pushing a commit")
    .action(async (cmdOpts: { expectedHead?: string; final?: string; dryRun?: boolean }) => {
      if (track) track.stage = "commit";
      const opts = program.opts<GlobalOptions>();
      const { repoRoot, workDir } = resolvePaths(opts, track);
      const expectedHead = cmdOpts.expectedHead?.trim() || process.env.UA_EXPECTED_HEAD?.trim();
      if (!expectedHead) {
        throw new StageError(
          "commit requires --expected-head <sha>.",
          EXIT_CODES.POLICY_OR_HASH,
          "commit",
          "missing_expected_head",
        );
      }
      const cfg = loadOptionalResolvedConfig({
        repoRoot,
        configPath: opts.config,
        fallbackDirs: [
          ...(cmdOpts.final ? [path.dirname(path.resolve(cmdOpts.final))] : []),
          path.join(workDir, ARTIFACTS.final.dir),
          path.join(workDir, ARTIFACTS.prepare.dir),
        ],
      });
      const clients = opts.offline || cmdOpts.dryRun ? {} : createGitHubClientsFromEnv(cfg?.commit.auth);
      const approvalCheckRaw = process.env.UA_APPROVAL_CHECK;
      const approvalCheck = approvalCheckRaw === "manual" || approvalCheckRaw === "api" ? approvalCheckRaw : undefined;
      const runIdParsed = process.env.GITHUB_RUN_ID ? Number.parseInt(process.env.GITHUB_RUN_ID, 10) : undefined;
      const res = await runCommit({
        workDir,
        repoRoot,
        configPath: opts.config,
        config: cfg,
        expectedHead,
        runId: Number.isFinite(runIdParsed) ? runIdParsed : undefined,
        finalPath: cmdOpts.final,
        approvalEnvironment: process.env.UA_APPROVAL_ENV ?? process.env.UA_APPROVAL_ENVIRONMENT,
        approvalCheck,
        github: clients.github,
        commitGithub: clients.commitGithub,
        dryRun: Boolean(opts.offline || cmdOpts.dryRun),
      });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
      } else {
        process.stdout.write(
          `commit: committed=${res.committed} fallback=${res.fallbackPatchPosted} sha=${res.commitSha ?? "none"} approvers=${res.approvers.length}\n`,
        );
      }
    });

  const localCmd = program.command("local").description("Local IDE / Copilot Chat commands");

  localCmd
    .command("init-chat")
    .description("Install .github/agents, .github/prompts, and optional .vscode/tasks.json")
    .option("--force", "Overwrite customized local files")
    .option("--with-tasks", "Also write .vscode/tasks.json")
    .option("--dry-run", "Show planned writes without modifying disk")
    .option("--json", "Output JSON summary")
    .action(async (cmdOpts: { force?: boolean; withTasks?: boolean; dryRun?: boolean; json?: boolean }) => {
      if (track) track.stage = "local";
      const opts = program.opts<GlobalOptions>();
      const { repoRoot, workDir } = resolvePaths(opts, track);
      const res = await runInitChat({
        repoRoot,
        workDir,
        configPath: opts.config,
        force: Boolean(cmdOpts.force),
        withTasks: Boolean(cmdOpts.withTasks),
        dryRun: Boolean(cmdOpts.dryRun),
      });
      if (opts.json || cmdOpts.json) {
        process.stdout.write(`${JSON.stringify(normalizeSummaryPaths(res), null, 2)}\n`);
      } else {
        for (const f of res.files) {
          process.stdout.write(`${f.action}: ${f.path}\n`);
        }
        process.stdout.write(`doctor: ok=${res.doctor.ok} (checks=${res.doctor.checks.length})\n`);
      }
    });

  localCmd
    .command("doctor")
    .description("Check Node, git, language toolchains, config, and WASM health")
    .option("--full", "Also verify runner preflight checks")
    .option("--light", "Run lightweight checks only")
    .option("--json", "Output bounded JSON summary")
    .action(async (cmdOpts: { full?: boolean; light?: boolean; json?: boolean }) => {
      if (track) track.stage = "local";
      const opts = program.opts<GlobalOptions>();
      const { repoRoot, workDir } = resolvePaths(opts, track);
      const summary = await runLocalDoctor({
        repoRoot,
        workDir,
        configPath: opts.config,
        full: Boolean(cmdOpts.full),
        light: Boolean(cmdOpts.light),
      });
      const norm = normalizeSummaryPaths(summary);
      if (opts.json || cmdOpts.json) {
        process.stdout.write(serializeBoundedSummary(norm));
      } else {
        for (const c of norm.checks) {
          process.stdout.write(`[${c.status.toUpperCase()}] ${c.name}: ${c.detail}\n`);
        }
        process.stdout.write(`doctor: ok=${norm.ok}\n`);
      }
      if (!summary.ok) {
        process.exitCode = EXIT_CODES.INTERNAL;
      }
    });

  localCmd
    .command("detect")
    .description("Detect uncovered diff targets in local git working tree")
    .option("--scope <scope>", "Diff scope: staged | worktree | branch | files")
    .option("--uncommitted", "Analyze staged + unstaged + untracked changes")
    .option("--staged", "Analyze staged changes only")
    .option("--base <ref>", "Analyze branch diff from <ref> (or merge-base) plus working tree")
    .option("--files <globs...>", "Explicit source files or globs")
    .option("--symbols <names...>", "Filter specific symbols (supports Class.* wildcard)")
    .option("--include-covered", "Include covered symbols above threshold")
    .option("--skip-baseline", "Skip running baseline test suite")
    .option("--refresh-baseline", "Force running baseline test suite and refresh cached coverage")
    .option("--coverage-file <path>", "Explicit coverage file path")
    .option("--json", "Output bounded JSON summary")
    .action(
      async (cmdOpts: {
        scope?: string;
        uncommitted?: boolean;
        staged?: boolean;
        base?: string;
        files?: string[];
        symbols?: string[];
        includeCovered?: boolean;
        skipBaseline?: boolean;
        refreshBaseline?: boolean;
        coverageFile?: string;
        json?: boolean;
      }) => {
        if (track) track.stage = "local";
        const opts = program.opts<GlobalOptions>();
        const { repoRoot, workDir } = resolvePaths(opts, track);
        let scope: "staged" | "worktree" | "branch" | "files" | undefined;
        if (cmdOpts.scope) {
          if (
            cmdOpts.scope !== "staged" &&
            cmdOpts.scope !== "worktree" &&
            cmdOpts.scope !== "branch" &&
            cmdOpts.scope !== "files"
          ) {
            throw new StageError(
              `Invalid --scope "${cmdOpts.scope}". Expected staged | worktree | branch | files.`,
              EXIT_CODES.CONFIG_OR_INPUT,
              "local",
              "invalid_scope",
            );
          }
          scope = cmdOpts.scope;
        } else if (cmdOpts.staged) {
          scope = "staged";
        } else if (cmdOpts.uncommitted) {
          scope = "worktree";
        } else if (cmdOpts.files && cmdOpts.files.length > 0) {
          scope = "files";
        } else if (cmdOpts.base) {
          scope = "branch";
        }

        let configOverride;
        if (cmdOpts.refreshBaseline && !cmdOpts.skipBaseline) {
          const loaded = loadConfig(repoRoot, opts.config).config;
          configOverride = {
            ...loaded,
            baseline: {
              ...loaded.baseline,
              mode: "run" as const,
            },
            local: {
              ...loaded.local,
              reuseCoverage: false,
            },
          };
        }

        const { summary } = await runLocalDetect({
          repoRoot,
          workDir,
          configPath: opts.config,
          config: configOverride,
          scope,
          baseRef: cmdOpts.base,
          files: cmdOpts.files,
          symbols: cmdOpts.symbols,
          includeCovered: Boolean(cmdOpts.includeCovered),
          skipBaseline: Boolean(cmdOpts.skipBaseline),
          coverageFile: cmdOpts.coverageFile,
        });
        const norm = normalizeSummaryPaths(summary);
        if (opts.json || cmdOpts.json) {
          process.stdout.write(serializeBoundedSummary(norm));
        } else {
          process.stdout.write(`detect(${norm.scope}): files=${norm.files.length} skipped=${norm.skipped.length}\n`);
          for (const f of norm.files) {
            process.stdout.write(`  [${f.fileId}] ${f.path} -> staged=${f.stagedPath} final=${f.testPath}\n`);
          }
          process.stdout.write(`next: ${norm.next}\n`);
        }
      },
    );

  localCmd
    .command("show [fileId]")
    .description("Print compact prompt context packet for a detected target file")
    .option("--context <fileId>", "Target fileId to display")
    .option("--max-chars <n>", "Maximum serialized characters for packet")
    .option("--json", "Output JSON")
    .action((fileIdArg: string | undefined, cmdOpts: { context?: string; maxChars?: string; json?: boolean }) => {
      if (track) track.stage = "local";
      const opts = program.opts<GlobalOptions>();
      const { workDir } = resolvePaths(opts, track);
      const fileId = fileIdArg ?? cmdOpts.context;
      if (!fileId) {
        throw new StageError(
          "local show requires <fileId> or --context <fileId>.",
          EXIT_CODES.CONFIG_OR_INPUT,
          "local",
          "missing_file_id",
        );
      }
      const maxChars = cmdOpts.maxChars ? parsePositiveIntOption(cmdOpts.maxChars, "--max-chars", "local") : undefined;
      const packet = runLocalShow({
        workDir,
        fileId,
        maxChars,
      });
      const norm = normalizeSummaryPaths(packet);
      if (opts.json || cmdOpts.json) {
        process.stdout.write(`${JSON.stringify(norm, null, 2)}\n`);
      } else {
        process.stdout.write(
          `File: ${norm.sourceFile.path} -> Test: ${norm.conventions.testPath} (${norm.targets.length} targets)\n`,
        );
        process.stdout.write(`${JSON.stringify(norm, null, 2)}\n`);
      }
    });

  localCmd
    .command("validate")
    .description("Validate local proposed tests staged under stagingDir")
    .option("--attempt <n>", "Validation attempt number (1, 2, ...)")
    .option("--phase <phase>", "Validation phase: static | run | all", "all")
    .option("--json", "Output bounded JSON summary")
    .action(async (cmdOpts: { attempt?: string; phase: string; json?: boolean }) => {
      if (track) track.stage = "local";
      if (cmdOpts.phase !== "static" && cmdOpts.phase !== "run" && cmdOpts.phase !== "all") {
        throw new StageError(
          `Invalid --phase "${cmdOpts.phase}". Expected static | run | all.`,
          EXIT_CODES.CONFIG_OR_INPUT,
          "local",
          "invalid_phase",
        );
      }
      const opts = program.opts<GlobalOptions>();
      const { repoRoot, workDir } = resolvePaths(opts, track);
      const attempt = cmdOpts.attempt ? parsePositiveIntOption(cmdOpts.attempt, "--attempt", "local") : undefined;
      const summary = await runLocalValidate({
        repoRoot,
        workDir,
        configPath: opts.config,
        attempt,
        phase: cmdOpts.phase,
      });
      const norm = normalizeSummaryPaths(summary);
      if (opts.json || cmdOpts.json) {
        process.stdout.write(serializeBoundedSummary(norm));
      } else {
        for (const f of norm.files) {
          process.stdout.write(`  [${f.fileId}] ${f.testPath}: ${f.outcome}${f.reason ? ` (${f.reason})` : ""}\n`);
        }
        process.stdout.write(`next: ${norm.next}\n`);
      }
      if (summary.environmentError) {
        process.exitCode = EXIT_CODES.INTERNAL;
      }
    });

  localCmd
    .command("apply")
    .description("Apply validated tests into repository")
    .option("--confirm", "Write validated files into the repository")
    .option("--yes", "Alias for --confirm")
    .option("--dry-run", "Preview test file placements without writing")
    .option("--stage", "Run git add on written test files (without committing)")
    .option("--files <pathsOrIds...>", "Apply only specified fileId or testPath entries")
    .option("--json", "Output bounded JSON summary")
    .action(
      async (cmdOpts: {
        confirm?: boolean;
        yes?: boolean;
        dryRun?: boolean;
        stage?: boolean;
        files?: string[];
        json?: boolean;
      }) => {
        if (track) track.stage = "local";
        const opts = program.opts<GlobalOptions>();
        const { repoRoot, workDir } = resolvePaths(opts, track);
        const confirm = Boolean((cmdOpts.confirm || cmdOpts.yes) && !cmdOpts.dryRun);
        const res = await runLocalApply({
          repoRoot,
          workDir,
          configPath: opts.config,
          confirm,
          stage: Boolean(cmdOpts.stage),
          files: cmdOpts.files,
        });
        const norm = normalizeSummaryPaths(res.summary);
        if (opts.json || cmdOpts.json) {
          process.stdout.write(serializeBoundedSummary(norm));
        } else {
          process.stdout.write(
            `apply(dryRun=${norm.dryRun}): written=${norm.written.length} refused=${norm.refused.length} staged=${norm.staged}\n`,
          );
          process.stdout.write(`next: ${norm.next}\n`);
        }
        if (res.exitCode !== EXIT_CODES.OK) {
          process.exitCode = res.exitCode;
        }
      },
    );

  localCmd
    .command("status")
    .description("Inspect active local diff state and detected targets")
    .option("--json", "Output bounded JSON summary")
    .action(async (cmdOpts: { json?: boolean }) => {
      if (track) track.stage = "local";
      const opts = program.opts<GlobalOptions>();
      const { repoRoot, workDir } = resolvePaths(opts, track);
      const summary = await runLocalStatus({
        repoRoot,
        workDir,
        configPath: opts.config,
      });
      const norm = normalizeSummaryPaths(summary);
      if (opts.json || cmdOpts.json) {
        process.stdout.write(serializeBoundedSummary(norm));
      } else {
        process.stdout.write(
          `status: stage=${norm.stage} attempt=${norm.attempt ?? "none"} files=${norm.files.length} staged=${norm.stagedFilesInGitStatus.length}\n`,
        );
        process.stdout.write(`next: ${norm.next}\n`);
      }
    });

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  maskStartupSecrets();
  process.exitCode = EXIT_CODES.OK;
  const track: CliTrackContext = {
    stage: "local",
    repoRoot: process.cwd(),
    workDir: path.resolve(process.cwd(), ".unit-agent"),
  };
  const program = buildProgram(track);
  try {
    await program.parseAsync(argv);
  } catch (err) {
    const opts = program.opts<GlobalOptions>();
    const isLocalCommand = argv.includes("local") || (argv.includes("config") && argv.includes("check"));
    const code: ExitCode = err instanceof StageError ? err.code : EXIT_CODES.INTERNAL;
    if (!isLocalCommand) {
      const rawStage = err instanceof StageError ? err.stage : track.stage;
      const stageForError: StageName =
        rawStage === "local" || rawStage === "config" || rawStage === "guard"
          ? track.stage === "local"
            ? "prepare"
            : track.stage
          : rawStage;
      const expectedStatusPath = path.join(track.workDir, stageDirName(stageForError), "status.json");
      if (!existsSync(expectedStatusPath)) {
        writeStageStatus(track.workDir, mapErrorToStageStatus(stageForError, err, track.repoRoot).status);
      }
    }
    const rawMsg = err instanceof Error ? err.message : String(err);
    const msg = sanitizeOutput(rawMsg, { repoRoot: track.repoRoot });
    process.stderr.write(`${msg}\n`);
    process.exitCode = resolveProcessExitCode(code, {
      strict: Boolean(opts.strict),
      isLocalCommand,
    });
  }
}

const isEntrypoint =
  typeof process.argv[1] === "string" && (process.argv[1].endsWith("cli.ts") || process.argv[1].endsWith("cli.js"));

if (isEntrypoint) {
  void runCli();
}
