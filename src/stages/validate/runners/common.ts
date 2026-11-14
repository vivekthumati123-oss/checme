import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FailureReason, LanguageConfig, UnitAgentConfig } from "../../../contracts";
import type { ExecResult } from "../../../exec/exec";

export interface RunnerTestCase {
  name: string;
  status: "pass" | "fail";
}

export interface RunnerRequest {
  workspaceRoot: string;
  repoRoot: string;
  languageConfig: LanguageConfig;
  config: UnitAgentConfig;
  sourcePath: string;
  testPath: string;
  javaTestClassName?: string;
  packageName?: string;
  withCoverage: boolean;
  offline: boolean;
}

export interface RunnerOutcome {
  exitCode: number;
  timedOut: boolean;
  tests: RunnerTestCase[];
  stdout: string;
  stderr: string;
  commandString: string;
  notes: string[];
  failureReason?: FailureReason;
  failureDetail?: string;
}

export function shouldUseOfflineWrapper(config: UnitAgentConfig, explicitOffline: boolean): boolean {
  return (explicitOffline || config.offline.strategy === "unshare") && config.offline.strategy === "unshare";
}

export function resolveOfflineScriptPath(repoRoot: string): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDir, "..", "scripts", "run-offline.sh"),
    path.resolve(moduleDir, "..", "..", "..", "..", "scripts", "run-offline.sh"),
    path.resolve(repoRoot, "scripts", "run-offline.sh"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[1]!;
}

export function cleanupTempFile(filePath: string): void {
  try {
    rmSync(filePath, { force: true });
  } catch {
    // ignore cleanup errors
  }
}

export function buildBaseOutcome(execRes: ExecResult, tests: RunnerTestCase[]): RunnerOutcome {
  return {
    exitCode: execRes.exitCode,
    timedOut: execRes.timedOut,
    tests,
    stdout: execRes.stdout,
    stderr: execRes.stderr,
    commandString: execRes.commandString,
    notes: execRes.notes,
  };
}
