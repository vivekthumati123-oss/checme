import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ConfigSchema } from "../../src/contracts";
import { runCommand } from "../../src/exec/exec";
import {
  matchToolchainMismatch,
  resolveJavaBuildTool,
  resolveToolchainForLanguage,
} from "../../src/languages/toolchains";
import { runBaseline } from "../../src/stages/baseline";
import { runDetect } from "../../src/stages/detect";
import { runNotice } from "../../src/stages/notice";
import { runPlan } from "../../src/stages/plan";
import { resolveOfflineScriptPath } from "../../src/stages/validate/runners";
import {
  matchWrapperBootstrapFailure,
  recordJavaWrapperFallback,
  resolveJavaExecutionTarget,
  rewriteWrapperCommandToSystem,
} from "../../src/stages/validate/runners/java/detect";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ua-stg5-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("toolchains and compat tables", () => {
  it("resolves toolchains with config > version-file > runner-default precedence", () => {
    const dir = makeTempDir();
    writeFileSync(path.join(dir, ".nvmrc"), "v20.19.0\n", "utf8");
    writeFileSync(path.join(dir, ".python-version"), "3.12.2\n", "utf8");
    writeFileSync(
      path.join(dir, "pom.xml"),
      "<project><properties><maven.compiler.release>21</maven.compiler.release></properties></project>",
      "utf8",
    );

    const cfg = ConfigSchema.parse({
      version: 1,
      languages: {
        javascript: {
          testCommand: "npx vitest run",
          coverageFile: "coverage/lcov.info",
          coverageFormat: "lcov",
          sourceGlobs: ["src/**/*.ts"],
          testPathPatterns: ["test/{name}.test.{ext}"],
        },
        python: {
          testCommand: "pytest",
          coverageFile: "coverage.xml",
          coverageFormat: "cobertura",
          sourceGlobs: ["src/**/*.py"],
          testPathPatterns: ["tests/test_{name}.py"],
        },
        java: {
          testCommand: "mvn test",
          coverageFile: "target/site/jacoco/jacoco.xml",
          coverageFormat: "jacoco",
          sourceGlobs: ["src/main/java/**/*.java"],
          testPathPatterns: ["src/test/java/{package}/{Name}Test.java"],
        },
      },
    });

    const nodeTc = resolveToolchainForLanguage({
      repoRoot: dir,
      language: "javascript",
      langConfig: cfg.languages.javascript!,
    });
    expect(nodeTc.entry.source).toBe("version-file");
    expect(nodeTc.entry.version).toBe("20.19");
    expect(nodeTc.tier).toBe("tested");

    const pyTc = resolveToolchainForLanguage({ repoRoot: dir, language: "python", langConfig: cfg.languages.python! });
    expect(pyTc.entry.version).toBe("3.12");
    expect(pyTc.supported).toBe(true);

    const javaTc = resolveToolchainForLanguage({ repoRoot: dir, language: "java", langConfig: cfg.languages.java! });
    expect(javaTc.entry.version).toBe("21");
    expect(javaTc.tier).toBe("tested");
  });

  it("detects ambiguous Java build tools and matches toolchain mismatch log patterns", () => {
    const dir = makeTempDir();
    writeFileSync(path.join(dir, "pom.xml"), "<project/>", "utf8");
    writeFileSync(path.join(dir, "build.gradle"), "plugins {}", "utf8");

    const cfg = ConfigSchema.parse({
      version: 1,
      languages: {
        java: {
          testCommand: "./gradlew test",
          coverageFile: "build/reports/jacoco/test/jacocoTestReport.xml",
          coverageFormat: "jacoco",
          sourceGlobs: ["src/main/java/**/*.java"],
          testPathPatterns: ["src/test/java/{package}/{Name}Test.java"],
        },
      },
    });

    const res = resolveJavaBuildTool(dir, cfg.languages.java!);
    expect(res.ambiguous).toMatch(/Both pom\.xml and build\.gradle/);

    expect(matchToolchainMismatch("Error: UnsupportedClassVersionError: class file version 65.0")).toMatchObject({
      reason: "toolchain_mismatch",
      language: "java",
    });
    expect(matchToolchainMismatch("Minimum supported Gradle version is 8.5")).toMatchObject({
      reason: "unsupported_tool_version",
      language: "java",
    });
  });
});

describe("plan, baseline, and detect end-to-end on real git repo", () => {
  it("plans affected languages, runs skipped baseline safely, and builds manifest + context packets", async () => {
    const repo = makeTempDir();
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(
      path.join(repo, ".unit-agent.yml"),
      [
        "version: 1",
        "baseline:",
        "  mode: skip",
        "languages:",
        "  javascript:",
        "    testCommand: node -e process.exit(0)",
        "    coverageFile: coverage/lcov.info",
        "    coverageFormat: lcov",
        "    sourceGlobs: ['src/**/*.ts']",
        "    testPathPatterns: ['test/{name}.test.{ext}']",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      path.join(repo, "src", "calc.ts"),
      "export function add(a: number, b: number) { return a + b; }\n",
      "utf8",
    );

    await runCommand("git", ["init", "-q"], { cwd: repo });
    await runCommand("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    await runCommand("git", ["config", "user.name", "Test User"], { cwd: repo });
    await runCommand("git", ["add", "."], { cwd: repo });
    await runCommand("git", ["commit", "-q", "-m", "init"], { cwd: repo });
    const baseSha = (await runCommand("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();

    // Commit a branchable untested change
    writeFileSync(
      path.join(repo, "src", "calc.ts"),
      [
        "export function divide(a: number, b: number): number {",
        "  if (b === 0) {",
        '    throw new Error("div by zero");',
        "  }",
        "  return a / b;",
        "}",
      ].join("\n"),
      "utf8",
    );
    await runCommand("git", ["add", "."], { cwd: repo });
    await runCommand("git", ["commit", "-q", "-m", "feat: add divide"], { cwd: repo });
    const headSha = (await runCommand("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();

    const workDir = path.join(repo, ".unit-agent");
    const planRes = await runPlan({
      repoRoot: repo,
      workDir,
      baseSha,
      headSha,
      writeOutputs: false,
    });
    expect(planRes.plan.languages).toEqual(["javascript"]);

    const baseRes = await runBaseline({
      repoRoot: repo,
      workDir,
      plan: planRes.plan,
      writeOutputs: false,
    });
    expect(baseRes.status).toBe("no_coverage");

    const manifest = await runDetect({
      repoRoot: repo,
      workDir,
      diffSource: { kind: "git-range", base: baseSha, head: headSha },
      baseline: baseRes,
      writeOutputs: false,
    });

    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0]?.path).toBe("src/calc.ts");
    expect(manifest.files[0]?.testPath).toBe("test/calc.test.ts");
    expect(manifest.files[0]?.symbols[0]?.qualifiedName).toBe("divide");
    expect(manifest.files[0]?.symbols[0]?.estimated).toBe(true);

    const ctxPath = path.join(workDir, "prepare", manifest.files[0]!.contextPath);
    const ctxJson = JSON.parse(readFileSync(ctxPath, "utf8"));
    expect(ctxJson.conventions.importHint).toContain("calc");
  });

  it("classifies timed-out baseline runs as no_coverage (never red) with actionable guidance", async () => {
    const repo = makeTempDir();
    const cfg = ConfigSchema.parse({
      version: 1,
      baseline: { mode: "run", timeoutMinutes: 1 },
      languages: {
        javascript: {
          testCommand: 'node -e "setTimeout(() => {}, 5000)"',
          coverageFile: "coverage/lcov.info",
          coverageFormat: "lcov",
          sourceGlobs: ["src/**/*.ts"],
          testPathPatterns: ["test/{name}.test.{ext}"],
        },
      },
    });
    const slowCfg = {
      ...cfg,
      baseline: { mode: "run" as const, timeoutMinutes: 0.002 as unknown as number },
    };

    const res = await runBaseline({
      repoRoot: repo,
      workDir: path.join(repo, ".unit-agent"),
      config: slowCfg,
      plan: { schemaVersion: 1, languages: ["javascript"], toolchains: {}, frameworks: {}, skipped: [], warnings: [] },
      writeOutputs: false,
    });

    expect(res.status).toBe("no_coverage");
    expect(res.perLanguage.javascript?.status).toBe("no_coverage");
    expect(res.perLanguage.javascript?.detail).toContain("baseline exceeded");
  });

  it("resolves run-offline.sh from package root rather than an external or untrusted target repo", () => {
    const extRepo = makeTempDir();
    mkdirSync(path.join(extRepo, "scripts"), { recursive: true });
    writeFileSync(path.join(extRepo, "scripts", "run-offline.sh"), "#!/bin/sh\necho untrusted\n", "utf8");

    const resolved = resolveOfflineScriptPath(extRepo);
    expect(path.resolve(resolved)).not.toBe(path.resolve(extRepo, "scripts", "run-offline.sh"));
    expect(resolved.replace(/\\/g, "/")).toMatch(/\/scripts\/run-offline\.sh$/);
  });

  it("detects Gradle wrapper download failure and resolves recorded system fallback", () => {
    const fail = matchWrapperBootstrapFailure(
      'Downloading https://services.invalid.example/distributions/gradle-9.9.9-bin.zip\nException in thread "main" java.net.UnknownHostException: services.invalid.example\n\tat org.gradle.wrapper.Install.forceFetch(SourceFile:2)',
    );
    expect(fail.isWrapperError).toBe(true);
    expect(fail.host).toBe("services.invalid.example");
    expect(rewriteWrapperCommandToSystem("./gradlew", "gradle")).toBe("gradle");

    const repo = makeTempDir();
    const workDir = path.join(repo, ".unit-agent");
    writeFileSync(path.join(repo, "build.gradle"), "plugins { id 'java' }\n", "utf8");
    writeFileSync(path.join(repo, "gradlew"), "#!/bin/sh\n", "utf8");
    recordJavaWrapperFallback(workDir, "gradle", "gradle", "fallback warning");

    const javaCfg = ConfigSchema.parse({
      version: 1,
      languages: {
        java: {
          testCommand: "./gradlew test",
          coverageFile: "build/reports/jacoco/test/jacocoTestReport.xml",
          coverageFormat: "jacoco",
          sourceGlobs: ["src/**/*.java"],
          testPathPatterns: ["src/test/java/{package}/{Name}Test.java"],
        },
      },
    }).languages.java!;

    const target = resolveJavaExecutionTarget({
      workspaceRoot: repo,
      workDir,
      javaConfig: javaCfg,
      sourcePath: "src/main/java/App.java",
      testPath: "src/test/java/AppTest.java",
    });
    expect(target.executable).toBe("gradle");
  });

  it("classifies baseline toolchain mismatch (Gradle 7.6.4 + JDK 21) and surfaces notice reason", async () => {
    const repo = makeTempDir();
    const workDir = path.join(repo, ".unit-agent");
    const cfg = ConfigSchema.parse({
      version: 1,
      baseline: { mode: "run", timeoutMinutes: 1 },
      languages: {
        java: {
          testCommand: "node -e \"console.error('BUG! Unsupported class file major version 65'); process.exit(1)\"",
          coverageFile: "build/reports/jacoco/test/jacocoTestReport.xml",
          coverageFormat: "jacoco",
          sourceGlobs: ["src/**/*.java"],
          testPathPatterns: ["src/test/java/{package}/{Name}Test.java"],
        },
      },
    });

    const baseRes = await runBaseline({
      repoRoot: repo,
      workDir,
      config: cfg,
      plan: { schemaVersion: 1, languages: ["java"], toolchains: {}, frameworks: {}, skipped: [], warnings: [] },
      writeOutputs: false,
    });
    expect(baseRes.perLanguage.java?.mismatchReason).toBe("toolchain_mismatch");
    mkdirSync(path.join(workDir, "prepare"), { recursive: true });
    writeFileSync(path.join(workDir, "prepare", "baseline.json"), JSON.stringify(baseRes, null, 2), "utf8");

    const md = await runNotice({
      repoRoot: repo,
      workDir,
      dryRun: true,
    });
    expect(md).toContain("toolchain_mismatch");
  });
});
