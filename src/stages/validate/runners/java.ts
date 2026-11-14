import type { JavaConfig } from "../../../contracts";
import type { RunnerOutcome, RunnerRequest } from "./common";
import { resolveJavaExecutionTarget } from "./java/detect";
import { runGradleSingleTest } from "./java/gradle";
import { runMavenSingleTest } from "./java/maven";

export async function runJavaSingleFile(req: RunnerRequest): Promise<RunnerOutcome> {
  const javaCfg = req.languageConfig as JavaConfig;
  const proj = resolveJavaExecutionTarget({
    workspaceRoot: req.workspaceRoot,
    javaConfig: javaCfg,
    sourcePath: req.sourcePath,
    testPath: req.testPath,
  });

  if (proj.ambiguous) {
    return {
      exitCode: 1,
      timedOut: false,
      tests: [],
      stdout: "",
      stderr: proj.ambiguous,
      commandString: "java-detect",
      notes: [],
      failureReason: "ambiguous_build_tool",
      failureDetail: proj.ambiguous,
    };
  }

  if (proj.wrapperMissingError) {
    return {
      exitCode: 1,
      timedOut: false,
      tests: [],
      stdout: "",
      stderr: proj.wrapperMissingError,
      commandString: proj.executable,
      notes: [],
      failureReason: "wrapper_unavailable",
      failureDetail: proj.wrapperMissingError,
    };
  }

  if (proj.buildTool === "gradle") {
    return runGradleSingleTest(req, proj);
  }
  return runMavenSingleTest(req, proj);
}
