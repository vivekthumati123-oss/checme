import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { loadConfig, tokenizeCommand } from "../config";
import {
  ARTIFACTS,
  EXIT_CODES,
  PlanOutputSchema,
  StageError,
  type LanguageKey,
  type LoggerLike,
  type PlanOutput,
  type UnitAgentConfig,
} from "../contracts";
import { runCommand } from "../exec/exec";
import { matchToolchainMismatch } from "../languages/toolchains";
import { sanitizeFailureOutput } from "../telemetry";

export interface RunInstallOptions {
  repoRoot: string;
  workDir: string;
  configPath?: string;
  config?: UnitAgentConfig;
  planPath?: string;
  plan?: PlanOutput;
  logger?: LoggerLike;
}

export interface InstallLanguageOutcome {
  language: LanguageKey;
  ran: boolean;
  exitCode: number;
  durationMs: number;
}

export async function runInstall(opts: RunInstallOptions): Promise<InstallLanguageOutcome[]> {
  const config = opts.config ?? loadConfig(opts.repoRoot, opts.configPath).config;

  let plan = opts.plan;
  if (!plan) {
    const p = opts.planPath ?? path.join(opts.workDir, ARTIFACTS.prepare.dir, "plan.json");
    if (!existsSync(p)) {
      throw new StageError(`Plan file not found: "${p}"`, EXIT_CODES.CONFIG_OR_INPUT, "prepare", "missing_plan");
    }
    plan = PlanOutputSchema.parse(JSON.parse(readFileSync(p, "utf8")));
  }

  const outcomes: InstallLanguageOutcome[] = [];

  for (const lang of plan.languages) {
    const langCfg = config.languages[lang];
    if (!langCfg || !langCfg.enabled) continue;

    if (!langCfg.installCommand) {
      outcomes.push({ language: lang, ran: false, exitCode: 0, durationMs: 0 });
      continue;
    }

    const cwd = path.resolve(opts.repoRoot, langCfg.workingDirectory || ".");
    const { file, args } = tokenizeCommand(langCfg.installCommand);
    const startMs = Date.now();
    const res = await runCommand(file, args, {
      cwd,
      timeoutMs: config.limits.runTimeoutMinutes * 60_000,
      config,
    });
    const durationMs = Date.now() - startMs;

    if (res.exitCode !== 0) {
      const combined = `${res.stdout}\n${res.stderr}`;
      const mismatch = matchToolchainMismatch(combined);
      const cleanTail = sanitizeFailureOutput(combined, { repoRoot: opts.repoRoot });
      opts.logger?.error({ language: lang, exitCode: res.exitCode, mismatch }, "Install command failed");
      throw new StageError(
        `Install failed for ${lang} (exit ${res.exitCode}): ${cleanTail}`,
        mismatch ? EXIT_CODES.CONFIG_OR_INPUT : EXIT_CODES.INTERNAL,
        "prepare",
        mismatch?.reason ?? "install_failed",
      );
    }

    outcomes.push({
      language: lang,
      ran: true,
      exitCode: res.exitCode,
      durationMs,
    });
  }

  return outcomes;
}
