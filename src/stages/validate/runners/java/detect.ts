import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ARTIFACTS, type JavaConfig, type LoggerLike, type UnitAgentConfig } from "../../../../contracts";
import { cleanRepoRelative, normalizeSlashes } from "../../../../core/paths";
import { runCommand, type ExecResult } from "../../../../exec/exec";
import { resolveJavaBuildTool } from "../../../../languages/toolchains";
import { parseJunitXmlReport } from "../pytest";
import type { RunnerTestCase } from "../common";

export const JAVA_WRAPPER_FALLBACK_FILE = "java-wrapper-fallback.json";

export function matchWrapperBootstrapFailure(output: string): {
  isWrapperError: boolean;
  host?: string;
  detail: string;
} {
  const hostMatch =
    /UnknownHostException:\s*([^\s:]+)/i.exec(output) ?? /Downloading\s+https?:\/\/([^/\s:]+)/i.exec(output);
  const host = hostMatch?.[1];
  const hasGradleWrapperClass =
    /Could not find or load main class org\.gradle\.wrapper/i.test(output) ||
    /org\.gradle\.wrapper\.(?:Install|GradleWrapperMain)/i.test(output);
  const hasMvnWrapperError = /mvnw(?:\.cmd)?.*(?:not found|No such file|failed)/i.test(output);
  const hasDownloadFailure =
    /Downloading\s+https?:\/\//i.test(output) &&
    /(UnknownHostException|ConnectException|SocketTimeoutException|SSLException|Connection refused|timed out|returned response code|IOException)/i.test(
      output,
    );

  if (!hasGradleWrapperClass && !hasMvnWrapperError && !hasDownloadFailure) {
    return { isWrapperError: false, detail: "" };
  }

  return {
    isWrapperError: true,
    host,
    detail: host
      ? `Wrapper download/bootstrap failed for host "${host}".`
      : "Build wrapper unavailable or failed to bootstrap.",
  };
}

export function rewriteWrapperCommandToSystem(executable: string, buildTool: "maven" | "gradle"): string | null {
  const base = path
    .basename(executable)
    .replace(/\.(bat|cmd|exe)$/i, "")
    .toLowerCase();
  if (buildTool === "gradle" && base === "gradlew") return "gradle";
  if (buildTool === "maven" && base === "mvnw") return "mvn";
  return null;
}

export function readJavaWrapperFallback(workDir: string | undefined, buildTool: "maven" | "gradle"): string | null {
  if (!workDir) return null;
  const p = path.join(workDir, ARTIFACTS.prepare.dir, JAVA_WRAPPER_FALLBACK_FILE);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as { buildTool?: string; executable?: string };
    if (parsed.buildTool === buildTool && typeof parsed.executable === "string" && parsed.executable) {
      return parsed.executable;
    }
  } catch {
    // ignore malformed fallback marker
  }
  return null;
}

function appendPlanWarningOrSkip(
  workDir: string,
  warning: string,
  skippedEntry?: { language: string; reason: string; found?: string },
): void {
  const planPath = path.join(workDir, ARTIFACTS.prepare.dir, "plan.json");
  if (!existsSync(planPath)) return;
  try {
    const plan = JSON.parse(readFileSync(planPath, "utf8")) as {
      warnings?: string[];
      skipped?: Array<{ language: string; reason: string; found?: string }>;
    };
    const warnings = Array.isArray(plan.warnings) ? plan.warnings : [];
    if (!warnings.includes(warning)) warnings.push(warning);
    plan.warnings = warnings;
    if (skippedEntry) {
      const skipped = Array.isArray(plan.skipped) ? plan.skipped : [];
      skipped.push(skippedEntry);
      plan.skipped = skipped;
    }
    writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  } catch {
    // ignore plan update failure
  }
}

export function recordJavaWrapperFallback(
  workDir: string,
  buildTool: "maven" | "gradle",
  executable: "gradle" | "mvn",
  warning: string,
): void {
  const prepDir = path.join(workDir, ARTIFACTS.prepare.dir);
  mkdirSync(prepDir, { recursive: true });
  writeFileSync(
    path.join(prepDir, JAVA_WRAPPER_FALLBACK_FILE),
    `${JSON.stringify({ buildTool, executable, warning }, null, 2)}\n`,
    "utf8",
  );
  appendPlanWarningOrSkip(workDir, warning);
}

export function recordWrapperUnavailableInPlan(workDir: string, host: string | undefined, warning: string): void {
  appendPlanWarningOrSkip(workDir, warning, {
    language: "java",
    reason: "wrapper_unavailable",
    found: host,
  });
}

export async function runJavaCommandWithWrapperHandling(params: {
  repoRoot: string;
  workDir?: string;
  config: UnitAgentConfig;
  javaConfig: JavaConfig;
  cwd: string;
  file: string;
  args: readonly string[];
  timeoutMs: number;
  killChildrenOnExit?: boolean;
  extraEnv?: Record<string, string | undefined>;
  useOfflineWrapper?: boolean;
  offlineScriptPath?: string;
  logger?: LoggerLike;
}): Promise<{
  execRes: ExecResult;
  wrapperUnavailable?: { host?: string; detail: string };
}> {
  const detectedTool = resolveJavaBuildTool(params.cwd, params.javaConfig).buildTool;
  const inferredTool: "maven" | "gradle" =
    detectedTool ?? (params.file.toLowerCase().includes("mvn") ? "maven" : "gradle");
  const priorFallback = readJavaWrapperFallback(params.workDir, inferredTool);
  const initialFile = priorFallback ?? params.file;

  const first = await runCommand(initialFile, params.args, {
    cwd: params.cwd,
    timeoutMs: params.timeoutMs,
    config: params.config,
    extraEnv: params.extraEnv,
    useOfflineWrapper: params.useOfflineWrapper,
    offlineScriptPath: params.offlineScriptPath,
    killChildrenOnExit: params.killChildrenOnExit,
  });

  if (first.exitCode === 0) {
    return { execRes: first };
  }

  const combined = `${first.stdout}\n${first.stderr}`;
  const wrapperFail = matchWrapperBootstrapFailure(combined);
  if (!wrapperFail.isWrapperError) {
    return { execRes: first };
  }

  const systemCmd = rewriteWrapperCommandToSystem(initialFile, inferredTool) as "gradle" | "mvn" | null;
  const hostLabel = wrapperFail.host ? `"${wrapperFail.host}"` : "wrapper host";
  const remedies = `Check distributionUrl in wrapper properties, configure runner proxy/network, or set strictWrapper: false to allow system ${inferredTool} fallback.`;

  if (!params.javaConfig.strictWrapper && params.javaConfig.toolPreference.includes("system") && systemCmd) {
    const retry = await runCommand(systemCmd, params.args, {
      cwd: params.cwd,
      timeoutMs: params.timeoutMs,
      config: params.config,
      extraEnv: params.extraEnv,
      useOfflineWrapper: params.useOfflineWrapper,
      offlineScriptPath: params.offlineScriptPath,
      killChildrenOnExit: params.killChildrenOnExit,
    });
    if (retry.exitCode === 0) {
      const warning = `Java wrapper download failed for ${hostLabel}; fell back to system "${systemCmd}". Set strictWrapper: true to disallow fallback or fix wrapper URL.`;
      if (params.workDir) {
        recordJavaWrapperFallback(params.workDir, inferredTool, systemCmd, warning);
      }
      params.logger?.warn({ buildTool: inferredTool, host: wrapperFail.host, fallback: systemCmd }, warning);
      return { execRes: retry };
    }
    const retryErr = retry.spawnError ? ` System "${systemCmd}" fallback also unavailable (${retry.spawnError}).` : "";
    const detail = `Java wrapper download failed for ${hostLabel}.${retryErr} ${remedies}`.trim();
    if (params.workDir) {
      recordWrapperUnavailableInPlan(params.workDir, wrapperFail.host, detail);
    }
    return { execRes: retry, wrapperUnavailable: { host: wrapperFail.host, detail } };
  }

  const detail = `Java wrapper unavailable (failed downloading from ${hostLabel}). ${remedies}`;
  if (params.workDir) {
    recordWrapperUnavailableInPlan(params.workDir, wrapperFail.host, detail);
  }
  return { execRes: first, wrapperUnavailable: { host: wrapperFail.host, detail } };
}

export interface JavaProjectResolution {
  buildTool: "maven" | "gradle";
  buildRootAbs: string;
  moduleDirAbs: string;
  moduleRelFromBuildRoot: string;
  executable: string;
  ambiguous?: string;
  wrapperMissingError?: string;
}

function isSameOrInsideDir(curAbs: string, stopAbs: string): boolean {
  const normCur = process.platform === "win32" ? path.resolve(curAbs).toLowerCase() : path.resolve(curAbs);
  const normStop = process.platform === "win32" ? path.resolve(stopAbs).toLowerCase() : path.resolve(stopAbs);
  const rel = path.relative(normStop, normCur);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function findNearestModuleDir(startFileAbs: string, stopRootAbs: string): string {
  let cur = path.dirname(startFileAbs);
  const stopNorm = path.resolve(stopRootAbs);

  while (isSameOrInsideDir(cur, stopNorm)) {
    if (
      existsSync(path.join(cur, "pom.xml")) ||
      existsSync(path.join(cur, "build.gradle")) ||
      existsSync(path.join(cur, "build.gradle.kts"))
    ) {
      return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return stopNorm;
}

export function resolveJavaExecutionTarget(params: {
  workspaceRoot: string;
  workDir?: string;
  javaConfig: JavaConfig;
  sourcePath: string;
  testPath: string;
}): JavaProjectResolution {
  const wdAbs = path.resolve(params.workspaceRoot, params.javaConfig.workingDirectory || ".");
  const testAbs = path.resolve(params.workspaceRoot, params.testPath);
  const moduleDirAbs = findNearestModuleDir(testAbs, wdAbs);

  const hasPom = existsSync(path.join(moduleDirAbs, "pom.xml")) || existsSync(path.join(wdAbs, "pom.xml"));
  const hasGradle =
    existsSync(path.join(moduleDirAbs, "build.gradle")) ||
    existsSync(path.join(moduleDirAbs, "build.gradle.kts")) ||
    existsSync(path.join(wdAbs, "build.gradle")) ||
    existsSync(path.join(wdAbs, "build.gradle.kts"));

  let buildTool: "maven" | "gradle";
  if (params.javaConfig.buildTool !== "auto") {
    buildTool = params.javaConfig.buildTool;
  } else if (hasPom && hasGradle) {
    return {
      buildTool: "maven",
      buildRootAbs: wdAbs,
      moduleDirAbs,
      moduleRelFromBuildRoot: cleanRepoRelative(normalizeSlashes(path.relative(wdAbs, moduleDirAbs))) || ".",
      executable: "mvn",
      ambiguous: `Both pom.xml and build.gradle(.kts) found in "${params.javaConfig.workingDirectory}". Set languages.java.buildTool explicitly.`,
    };
  } else {
    buildTool = hasGradle ? "gradle" : "maven";
  }

  const wrapperName = buildTool === "gradle" ? "./gradlew" : "./mvnw";
  const systemName = buildTool === "gradle" ? "gradle" : "mvn";
  const wrapperExists =
    existsSync(path.join(wdAbs, wrapperName)) ||
    existsSync(path.join(wdAbs, buildTool === "gradle" ? "gradlew.bat" : "mvnw.cmd")) ||
    existsSync(path.join(moduleDirAbs, wrapperName)) ||
    existsSync(path.join(moduleDirAbs, buildTool === "gradle" ? "gradlew.bat" : "mvnw.cmd"));

  const fallbackExecutable = readJavaWrapperFallback(params.workDir, buildTool);

  let executable = systemName;
  if (fallbackExecutable) {
    executable = fallbackExecutable;
  } else if (params.javaConfig.toolPreference[0] === "wrapper") {
    if (wrapperExists) {
      executable = wrapperName;
    } else if (params.javaConfig.strictWrapper) {
      return {
        buildTool,
        buildRootAbs: wdAbs,
        moduleDirAbs,
        moduleRelFromBuildRoot: cleanRepoRelative(normalizeSlashes(path.relative(wdAbs, moduleDirAbs))) || ".",
        executable: wrapperName,
        wrapperMissingError: `languages.java.strictWrapper is true, but ${wrapperName} was not found.`,
      };
    }
  } else if (!params.javaConfig.toolPreference.includes("system") && wrapperExists) {
    executable = wrapperName;
  }

  const moduleRelFromBuildRoot = cleanRepoRelative(normalizeSlashes(path.relative(wdAbs, moduleDirAbs))) || ".";

  return {
    buildTool,
    buildRootAbs: wdAbs,
    moduleDirAbs,
    moduleRelFromBuildRoot,
    executable,
  };
}

export function collectJavaXmlTestResults(reportsDirAbs: string, classSimpleName?: string): RunnerTestCase[] {
  if (!existsSync(reportsDirAbs)) return [];
  const entries = readdirSync(reportsDirAbs);
  const matching = entries.filter((f) => {
    if (!f.endsWith(".xml") || !f.startsWith("TEST-")) return false;
    if (!classSimpleName) return true;
    return (
      f === `TEST-${classSimpleName}.xml` ||
      f.endsWith(`.${classSimpleName}.xml`) ||
      f.startsWith(`TEST-${classSimpleName}$`) ||
      f.includes(`.${classSimpleName}$`)
    );
  });

  const out: RunnerTestCase[] = [];
  for (const fileName of matching) {
    out.push(...parseJunitXmlReport(path.join(reportsDirAbs, fileName)));
  }
  return out;
}
