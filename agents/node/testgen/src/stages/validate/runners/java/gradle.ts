import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tokenizeCommand } from "../../../../config";
import type { JavaConfig } from "../../../../contracts";
import { classifyExecutionFailure } from "../../classify";
import { buildBaseOutcome, type RunnerOutcome, type RunnerRequest } from "../common";
import {
  collectJavaXmlTestResults,
  deleteStaleJavaXmlResults,
  runJavaCommandWithWrapperHandling,
  type JavaProjectResolution,
} from "./detect";

export function locateJacocoInitScript(): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDir, "unit-agent-jacoco.init.gradle"),
    path.resolve(moduleDir, "jacoco-init.gradle"),
    path.resolve(moduleDir, "..", "..", "..", "..", "dist", "unit-agent-jacoco.init.gradle"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export async function runGradleSingleTest(req: RunnerRequest, proj: JavaProjectResolution): Promise<RunnerOutcome> {
  const javaCfg = req.languageConfig as JavaConfig;
  const parsed = tokenizeCommand(javaCfg.testCommand);
  const parsedBase = path
    .basename(parsed.file)
    .replace(/\.(bat|cmd|exe)$/i, "")
    .toLowerCase();
  const execFile = parsedBase === "gradle" || parsedBase === "gradlew" ? proj.executable : parsed.file;

  const testClass = req.javaTestClassName ?? path.posix.parse(req.testPath).name;
  const runArgs = [...parsed.args];

  const isMultiModule = proj.moduleRelFromBuildRoot !== ".";
  const modulePrefix = isMultiModule ? `:${proj.moduleRelFromBuildRoot.split("/").filter(Boolean).join(":")}` : "";
  const moduleTask = isMultiModule ? `${modulePrefix}:test` : "test";
  const jacocoTask = isMultiModule ? `${modulePrefix}:jacocoTestReport` : "jacocoTestReport";

  if (isMultiModule) {
    const plainIdx = runArgs.indexOf("test");
    if (plainIdx >= 0) {
      runArgs[plainIdx] = moduleTask;
    } else if (!runArgs.some((a) => a.endsWith(":test"))) {
      runArgs.push(moduleTask);
    }
    for (let i = 0; i < runArgs.length; i += 1) {
      if (runArgs[i] === "jacocoTestReport") {
        runArgs[i] = jacocoTask;
      }
    }
  } else if (!runArgs.some((a) => a === "test" || a.endsWith(":test"))) {
    runArgs.push("test");
  }

  if (!runArgs.includes("--tests")) {
    const filter = req.packageName ? `${req.packageName}.${testClass}` : `*${testClass}`;
    const testIdx = runArgs.findIndex((a) => a === moduleTask || a === "test" || a.endsWith(":test"));
    if (testIdx >= 0) {
      runArgs.splice(testIdx + 1, 0, "--tests", filter);
    } else {
      runArgs.push("--tests", filter);
    }
  }

  const initScript =
    req.withCoverage && (javaCfg.coverage.mode === "auto" || javaCfg.coverage.mode === "inject")
      ? locateJacocoInitScript()
      : null;

  if (initScript && !runArgs.includes("-I") && !runArgs.includes("--init-script")) {
    runArgs.push("-I", initScript);
  }
  if (!runArgs.includes("--daemon") && !runArgs.includes("--no-daemon")) {
    runArgs.push("--no-daemon");
  }
  if (req.isFlakeRerun && !runArgs.includes("--rerun-tasks")) {
    runArgs.push("--rerun-tasks");
  }
  if (req.offline && !runArgs.includes("--offline")) {
    runArgs.push("--offline");
  }

  const reportsDir = javaCfg.testResultsDir
    ? path.resolve(proj.moduleDirAbs, javaCfg.testResultsDir)
    : path.join(proj.moduleDirAbs, "build", "test-results", "test");
  deleteStaleJavaXmlResults(reportsDir, testClass);

  const extraEnv = javaCfg.coverage.jacocoVersion ? { UA_JACOCO_VERSION: javaCfg.coverage.jacocoVersion } : undefined;
  const { execRes, wrapperUnavailable } = await runJavaCommandWithWrapperHandling({
    repoRoot: req.repoRoot,
    workDir: req.workDir,
    config: req.config,
    javaConfig: javaCfg,
    cwd: proj.buildRootAbs,
    file: execFile,
    args: runArgs,
    timeoutMs: req.config.limits.perRunTestTimeoutSeconds * 1000,
    extraEnv,
    killChildrenOnExit: true,
    useOfflineWrapper: false,
  });

  const tests = collectJavaXmlTestResults(reportsDir, testClass);
  const outcome = buildBaseOutcome(execRes, tests);
  if (wrapperUnavailable) {
    outcome.failureReason = "wrapper_unavailable";
    outcome.failureDetail = wrapperUnavailable.detail;
  } else if (execRes.exitCode !== 0) {
    const classified = classifyExecutionFailure(execRes, "java");
    outcome.failureReason = classified.reason;
    outcome.failureDetail = classified.detail;
  }
  return outcome;
}
