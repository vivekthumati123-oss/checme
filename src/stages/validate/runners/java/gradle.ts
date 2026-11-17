import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tokenizeCommand } from "../../../../config";
import type { JavaConfig } from "../../../../contracts";
import { runCommand } from "../../../../exec/exec";
import { classifyExecutionFailure } from "../../classify";
import {
  buildBaseOutcome,
  resolveOfflineScriptPath,
  shouldUseOfflineWrapper,
  type RunnerOutcome,
  type RunnerRequest,
} from "../common";
import { collectJavaXmlTestResults, type JavaProjectResolution } from "./detect";

export function locateJacocoInitScript(): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDir, "unit-agent-jacoco.init.gradle"),
    path.resolve(moduleDir, "..", "..", "dist", "unit-agent-jacoco.init.gradle"),
    path.resolve(process.cwd(), "dist", "unit-agent-jacoco.init.gradle"),
    path.resolve(moduleDir, "jacoco-init.gradle"),
    path.resolve(process.cwd(), "src", "stages", "validate", "runners", "java", "jacoco-init.gradle"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export async function runGradleSingleTest(req: RunnerRequest, proj: JavaProjectResolution): Promise<RunnerOutcome> {
  const javaCfg = req.languageConfig as JavaConfig;
  const parsed = tokenizeCommand(javaCfg.testCommand);
  const execFile =
    parsed.file === "gradle" || parsed.file === "./gradlew" || parsed.file === "gradlew"
      ? proj.executable
      : parsed.file;

  const testClass = req.javaTestClassName ?? path.posix.parse(req.testPath).name;
  const runArgs = [...parsed.args];

  if (!runArgs.some((a) => a === "test" || a.endsWith(":test"))) {
    runArgs.push("test");
  }
  if (proj.moduleRelFromBuildRoot !== "." && !runArgs.includes("-p")) {
    runArgs.push("-p", proj.moduleDirAbs);
  }
  if (!runArgs.includes("--tests")) {
    const filter = req.packageName ? `${req.packageName}.${testClass}` : `*${testClass}`;
    runArgs.push("--tests", filter);
  }

  const initScript =
    req.withCoverage && (javaCfg.coverage.mode === "auto" || javaCfg.coverage.mode === "inject")
      ? locateJacocoInitScript()
      : null;

  if (initScript && !runArgs.includes("-I") && !runArgs.includes("--init-script")) {
    runArgs.push("-I", initScript);
  }
  if (req.offline && !runArgs.includes("--offline")) {
    runArgs.push("--offline");
  }

  const execRes = await runCommand(execFile, runArgs, {
    cwd: proj.buildRootAbs,
    timeoutMs: req.config.limits.perRunTestTimeoutSeconds * 1000,
    config: req.config,
    extraEnv: javaCfg.coverage.jacocoVersion ? { UA_JACOCO_VERSION: javaCfg.coverage.jacocoVersion } : undefined,
    useOfflineWrapper: shouldUseOfflineWrapper(req.config, req.offline),
    offlineScriptPath: resolveOfflineScriptPath(req.repoRoot),
    killChildrenOnExit: true,
  });

  const reportsDir = javaCfg.testResultsDir
    ? path.resolve(proj.moduleDirAbs, javaCfg.testResultsDir)
    : path.join(proj.moduleDirAbs, "build", "test-results", "test");

  const tests = collectJavaXmlTestResults(reportsDir, testClass);
  const outcome = buildBaseOutcome(execRes, tests);
  if (execRes.exitCode !== 0) {
    const classified = classifyExecutionFailure(execRes);
    outcome.failureReason = classified.reason;
    outcome.failureDetail = classified.detail;
  }
  return outcome;
}
