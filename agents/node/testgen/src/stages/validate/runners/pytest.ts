import { XMLParser } from "fast-xml-parser";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { tokenizeCommand } from "../../../config";
import type { PythonConfig } from "../../../contracts";
import { resolvePythonRoots } from "../../../core/context";
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

interface JunitTestCaseNode {
  "@_name"?: string;
  "@_classname"?: string;
  failure?: unknown;
  error?: unknown;
  skipped?: unknown;
}

interface JunitSuiteNode {
  testcase?: JunitTestCaseNode | JunitTestCaseNode[];
}

interface JunitRoot {
  testsuites?: { testsuite?: JunitSuiteNode | JunitSuiteNode[] };
  testsuite?: JunitSuiteNode;
}

function asArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined) return [];
  return Array.isArray(val) ? val : [val];
}

export function parseJunitXmlReport(xmlPath: string): RunnerTestCase[] {
  if (!existsSync(xmlPath)) return [];
  try {
    const raw = readFileSync(xmlPath, "utf8");
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      processEntities: false,
    });
    const parsed = parser.parse(raw) as JunitRoot;
    const suites: JunitSuiteNode[] = [
      ...asArray(parsed?.testsuites?.testsuite),
      ...(parsed?.testsuite ? [parsed.testsuite] : []),
    ];

    const out: RunnerTestCase[] = [];
    for (const suite of suites) {
      for (const tc of asArray(suite.testcase)) {
        if (tc.skipped !== undefined) continue;
        const name = tc["@_name"] ?? "unnamed";
        const failed = tc.failure !== undefined || tc.error !== undefined;
        out.push({ name, status: failed ? "fail" : "pass" });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function runPytestSingleFile(req: RunnerRequest): Promise<RunnerOutcome> {
  const wdAbs = path.resolve(req.workspaceRoot, req.languageConfig.workingDirectory || ".");
  const relTestPath = fromRepoPath(req.testPath, req.languageConfig.workingDirectory);
  const { file, args } = tokenizeCommand(req.languageConfig.testCommand);

  const xmlOut = path.join(os.tmpdir(), `ua-pytest-${Date.now()}-${Math.random().toString(36).slice(2)}.xml`);
  const pyCfg = req.languageConfig as PythonConfig;
  const pyRoots = resolvePythonRoots({
    repoRoot: req.workspaceRoot,
    workingDirectory: req.languageConfig.workingDirectory,
    configuredPythonPath: pyCfg.pythonPath,
  });

  const extraPythonPath = pyRoots.map((r) => path.resolve(req.workspaceRoot, r)).join(path.delimiter);

  const runArgs = [...args];
  if (runArgs.some((a) => /pytest/i.test(a)) || /pytest/i.test(file)) {
    runArgs.push(relTestPath, `--junitxml=${xmlOut}`);
    if (req.withCoverage) {
      if (!runArgs.some((a) => a === "--cov" || a.startsWith("--cov="))) {
        runArgs.push("--cov=.");
      }
      const hasXmlCovReport = runArgs.some(
        (a, idx) =>
          a.startsWith("--cov-report=xml") || (a === "--cov-report" && Boolean(runArgs[idx + 1]?.startsWith("xml"))),
      );
      if (!hasXmlCovReport) {
        const relCovOut = fromRepoPath(req.languageConfig.coverageFile, req.languageConfig.workingDirectory);
        runArgs.push(`--cov-report=xml:${relCovOut}`);
      }
    } else if (runArgs.some((a) => a === "--cov" || a.startsWith("--cov=")) && !runArgs.includes("--no-cov")) {
      runArgs.push("--no-cov");
    }
  } else {
    runArgs.push(relTestPath);
  }

  try {
    const execRes = await runCommand(file, runArgs, {
      cwd: wdAbs,
      timeoutMs: req.config.limits.perRunTestTimeoutSeconds * 1000,
      config: req.config,
      extraEnv: extraPythonPath ? { PYTHONPATH: extraPythonPath } : undefined,
      useOfflineWrapper: shouldUseOfflineWrapper(req.config, req.offline),
      offlineScriptPath: resolveOfflineScriptPath(req.repoRoot),
      killChildrenOnExit: true,
    });

    const tests = parseJunitXmlReport(xmlOut);
    const outcome = buildBaseOutcome(execRes, tests);
    if (execRes.exitCode !== 0) {
      const classified = classifyExecutionFailure(execRes, "python");
      outcome.failureReason = classified.reason;
      outcome.failureDetail = classified.detail;
    }
    return outcome;
  } finally {
    cleanupTempFile(xmlOut);
  }
}
