import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { tokenizeCommand } from "../../../config";
import { fromRepoPath } from "../../../core/paths";
import { runCommand } from "../../../exec/exec";
import { classifyExecutionFailure } from "../classify";
import {
  buildBaseOutcome,
  cleanupTempFile,
  resolveOfflineScriptPath,
  shouldUseOfflineWrapper,
  type RunnerOutcome,
  type RunnerRequest,
  type RunnerTestCase,
} from "./common";

interface JsonReportShape {
  testResults?: Array<{
    assertionResults?: Array<{
      fullName?: string;
      title?: string;
      status?: string;
    }>;
  }>;
}

export function parseJsJsonReport(filePath: string): RunnerTestCase[] {
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as JsonReportShape;
    const cases: RunnerTestCase[] = [];
    for (const suite of parsed.testResults ?? []) {
      for (const a of suite.assertionResults ?? []) {
        if (a.status === "pending" || a.status === "skipped" || a.status === "todo") {
          continue;
        }
        const name = a.title ?? a.fullName ?? "unnamed";
        cases.push({
          name,
          status: a.status === "passed" ? "pass" : "fail",
        });
      }
    }
    return cases;
  } catch {
    return [];
  }
}

export async function runVitestSingleFile(req: RunnerRequest): Promise<RunnerOutcome> {
  const wdAbs = path.resolve(req.workspaceRoot, req.languageConfig.workingDirectory || ".");
  const relTestPath = fromRepoPath(req.testPath, req.languageConfig.workingDirectory);
  const { file, args } = tokenizeCommand(req.languageConfig.testCommand);

  const jsonOut = path.join(os.tmpdir(), `ua-vitest-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const runArgs = [...args];
  if (runArgs.some((a) => /vitest/i.test(a)) || /vitest/i.test(file)) {
    if (!runArgs.includes("run")) runArgs.push("run");
    runArgs.push(relTestPath, "--reporter=json", `--outputFile=${jsonOut}`);
    if (req.withCoverage) {
      if (!runArgs.some((a) => a === "--coverage" || a.startsWith("--coverage."))) {
        runArgs.push("--coverage.enabled=true");
      }
    } else if (
      runArgs.some((a) => a === "--coverage" || a.startsWith("--coverage.")) &&
      !runArgs.includes("--coverage.enabled=false")
    ) {
      runArgs.push("--coverage.enabled=false");
    }
  } else {
    runArgs.push(relTestPath);
  }

  try {
    const execRes = await runCommand(file, runArgs, {
      cwd: wdAbs,
      timeoutMs: req.config.limits.perRunTestTimeoutSeconds * 1000,
      config: req.config,
      useOfflineWrapper: shouldUseOfflineWrapper(req.config, req.offline),
      offlineScriptPath: resolveOfflineScriptPath(req.repoRoot),
      killChildrenOnExit: true,
    });

    const tests = parseJsJsonReport(jsonOut);
    const outcome = buildBaseOutcome(execRes, tests);
    if (execRes.exitCode !== 0) {
      const classified = classifyExecutionFailure(execRes, "javascript");
      outcome.failureReason = classified.reason;
      outcome.failureDetail = classified.detail;
    }
    return outcome;
  } finally {
    cleanupTempFile(jsonOut);
  }
}
