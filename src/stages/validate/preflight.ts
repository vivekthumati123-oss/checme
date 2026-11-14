import { existsSync } from "node:fs";
import path from "node:path";

import { tokenizeCommand } from "../../config";
import type { FailureReason, JavaConfig, LanguageConfig, LanguageKey, UnitAgentConfig } from "../../contracts";
import { runCommand } from "../../exec/exec";
import { resolveJavaBuildTool } from "../../languages/toolchains";

export interface PreflightOutcome {
  ok: boolean;
  reason?: FailureReason;
  detail: string;
}

export async function runRunnerPreflight(params: {
  workspaceRoot: string;
  language: LanguageKey;
  langConfig: LanguageConfig;
  config: UnitAgentConfig;
  phase: "static" | "run" | "all";
}): Promise<PreflightOutcome> {
  if (params.phase === "static") {
    return { ok: true, detail: "static-only phase skips external runner preflight" };
  }

  const wdAbs = path.resolve(params.workspaceRoot, params.langConfig.workingDirectory || ".");
  if (!existsSync(wdAbs)) {
    return {
      ok: false,
      reason: "environment_error",
      detail: `Language workingDirectory "${params.langConfig.workingDirectory}" does not exist.`,
    };
  }

  if (params.language === "java") {
    const bt = resolveJavaBuildTool(params.workspaceRoot, params.langConfig as JavaConfig);
    if (bt.ambiguous) {
      return { ok: false, reason: "ambiguous_build_tool", detail: bt.ambiguous };
    }
    if (!bt.buildTool) {
      return {
        ok: false,
        reason: "tool_missing",
        detail: `No pom.xml or build.gradle(.kts) found in "${params.langConfig.workingDirectory}".`,
      };
    }
  }

  const { file } = tokenizeCommand(params.langConfig.testCommand);
  // Check local wrapper existence if command starts with ./
  if (file.startsWith("./") || file.startsWith(".\\")) {
    const candidateAbs = path.resolve(wdAbs, file);
    const winBat = `${candidateAbs}.bat`;
    const winCmd = `${candidateAbs}.cmd`;
    if (!existsSync(candidateAbs) && !(process.platform === "win32" && (existsSync(winBat) || existsSync(winCmd)))) {
      return {
        ok: false,
        reason: "wrapper_unavailable",
        detail: `Wrapper executable "${file}" not found under "${params.langConfig.workingDirectory}".`,
      };
    }
    return { ok: true, detail: `wrapper present: ${file}` };
  }

  // Probe executable version safely for bare commands (e.g. pytest, mvn, node, npx)
  const checkCmd = file === "pytest" ? "pytest" : file;
  const probe = await runCommand(checkCmd, ["--version"], {
    cwd: wdAbs,
    timeoutMs: 15_000,
    config: params.config,
  });

  if (probe.spawnError || probe.exitCode !== 0) {
    return {
      ok: false,
      reason: "tool_missing",
      detail: `Executable "${checkCmd}" not found (${probe.spawnError ?? `exit ${probe.exitCode}`}).`,
    };
  }

  return { ok: true, detail: `${checkCmd} available` };
}
