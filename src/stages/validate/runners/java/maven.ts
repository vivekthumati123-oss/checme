import path from "node:path";

import { tokenizeCommand } from "../../../../config";
import type { JavaConfig } from "../../../../contracts";
import { classifyExecutionFailure } from "../../classify";
import {
  buildBaseOutcome,
  resolveOfflineScriptPath,
  shouldUseOfflineWrapper,
  type RunnerOutcome,
  type RunnerRequest,
} from "../common";
import { collectJavaXmlTestResults, runJavaCommandWithWrapperHandling, type JavaProjectResolution } from "./detect";

export async function runMavenSingleTest(req: RunnerRequest, proj: JavaProjectResolution): Promise<RunnerOutcome> {
  const javaCfg = req.languageConfig as JavaConfig;
  const parsed = tokenizeCommand(javaCfg.testCommand);
  const execFile =
    parsed.file === "mvn" || parsed.file === "./mvnw" || parsed.file === "mvnw" ? proj.executable : parsed.file;

  const testClass = req.javaTestClassName ?? path.posix.parse(req.testPath).name;
  const runArgs = [...parsed.args];

  if (!runArgs.some((a) => a === "test" || a === "verify")) {
    runArgs.push("test");
  }
  if (proj.moduleRelFromBuildRoot !== "." && !runArgs.includes("-pl")) {
    runArgs.push("-pl", proj.moduleRelFromBuildRoot, "-am", "-DfailIfNoTests=false");
  }
  if (!runArgs.some((a) => a.startsWith("-Dtest="))) {
    runArgs.push(`-Dtest=${testClass}`);
  }
  if (req.offline && !runArgs.includes("-o")) {
    runArgs.push("-o");
  }

  const { execRes, wrapperUnavailable } = await runJavaCommandWithWrapperHandling({
    repoRoot: req.repoRoot,
    file: execFile,
    args: runArgs,
    cwd: proj.buildRootAbs,
    workDir: req.workDir,
    javaConfig: javaCfg,
    config: req.config,
    timeoutMs: req.config.limits.perRunTestTimeoutSeconds * 1000,
    killChildrenOnExit: true,
    useOfflineWrapper: shouldUseOfflineWrapper(req.config, req.offline),
    offlineScriptPath: resolveOfflineScriptPath(req.repoRoot),
  });

  const reportsDir = javaCfg.testResultsDir
    ? path.resolve(proj.moduleDirAbs, javaCfg.testResultsDir)
    : path.join(proj.moduleDirAbs, "target", "surefire-reports");

  const tests = collectJavaXmlTestResults(reportsDir, testClass);
  const outcome = buildBaseOutcome(execRes, tests);
  if (wrapperUnavailable) {
    outcome.failureReason = "wrapper_unavailable";
    outcome.failureDetail = wrapperUnavailable.detail;
  } else if (execRes.exitCode !== 0) {
    const classified = classifyExecutionFailure(execRes);
    outcome.failureReason = classified.reason;
    outcome.failureDetail = classified.detail;
  }
  return outcome;
}
