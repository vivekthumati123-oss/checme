import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import type { JavaConfig } from "../../../../contracts";
import { cleanRepoRelative, normalizeSlashes } from "../../../../core/paths";
import { parseJunitXmlReport } from "../pytest";
import type { RunnerTestCase } from "../common";

export interface JavaProjectResolution {
  buildTool: "maven" | "gradle";
  buildRootAbs: string;
  moduleDirAbs: string;
  moduleRelFromBuildRoot: string;
  executable: string;
  ambiguous?: string;
  wrapperMissingError?: string;
}

function findNearestModuleDir(startFileAbs: string, stopRootAbs: string): string {
  let cur = path.dirname(startFileAbs);
  const stopNorm = path.resolve(stopRootAbs);

  while (cur.startsWith(stopNorm)) {
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

  let executable = systemName;
  if (params.javaConfig.toolPreference[0] === "wrapper") {
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
    return f.includes(classSimpleName);
  });

  const out: RunnerTestCase[] = [];
  for (const fileName of matching) {
    out.push(...parseJunitXmlReport(path.join(reportsDirAbs, fileName)));
  }
  return out;
}
