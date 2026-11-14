import type { FrameworkName } from "../../../contracts";
import type { RunnerOutcome, RunnerRequest } from "./common";
import { runJavaSingleFile } from "./java";
import { runJestSingleFile } from "./jest";
import { runPytestSingleFile } from "./pytest";
import { runVitestSingleFile } from "./vitest";

export * from "./common";
export * from "./java";
export * from "./jest";
export * from "./pytest";
export * from "./vitest";

export async function runSingleFileTests(framework: FrameworkName, req: RunnerRequest): Promise<RunnerOutcome> {
  switch (framework) {
    case "vitest":
      return runVitestSingleFile(req);
    case "jest":
      return runJestSingleFile(req);
    case "pytest":
      return runPytestSingleFile(req);
    case "junit5":
      return runJavaSingleFile(req);
  }
}
