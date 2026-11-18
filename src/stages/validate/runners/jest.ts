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
} from "./common";
import { parseJsJsonReport } from "./vitest";

export async function runJestSingleFile(req: RunnerRequest): Promise<RunnerOutcome> {
  const wdAbs = path.resolve(req.workspaceRoot, req.languageConfig.workingDirectory || ".");
  const relTestPath = fromRepoPath(req.testPath, req.languageConfig.workingDirectory);
  const { file, args } = tokenizeCommand(req.languageConfig.testCommand);

  const jsonOut = path.join(os.tmpdir(), `ua-jest-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const runArgs = [...args];
  if (runArgs.some((a) => /jest/i.test(a)) || /jest/i.test(file)) {
    runArgs.push("--runTestsByPath", relTestPath, "--json", `--outputFile=${jsonOut}`);
    if (req.withCoverage && !runArgs.includes("--coverage")) {
      runArgs.push("--coverage");
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
      const classified = classifyExecutionFailure(execRes);
      outcome.failureReason = classified.reason;
      outcome.failureDetail = classified.detail;
    }
    return outcome;
  } finally {
    cleanupTempFile(jsonOut);
  }
}
