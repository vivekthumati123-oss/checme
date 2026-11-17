import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ConfigSchema, EXIT_CODES } from "../../src/contracts";
import { sha256Hex } from "../../src/core/context";
import { FakeLlmClient, isAuthErrorMessage } from "../../src/llm";
import { runGenerate } from "../../src/stages/generate";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ua-gen-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function setupManifestFixture(dir: string, targetCount = 3) {
  const workDir = path.join(dir, ".unit-agent");
  const prepareDir = path.join(workDir, "prepare");
  const contextsDir = path.join(prepareDir, "contexts");
  mkdirSync(contextsDir, { recursive: true });
  mkdirSync(path.join(dir, "src"), { recursive: true });

  const sourceContent = "export function f1() {}\nexport function f2() {}\nexport function f3() {}\n";
  writeFileSync(path.join(dir, "src", "app.ts"), sourceContent, "utf8");
  const sourceSha = sha256Hex(sourceContent);

  const symbols = Array.from({ length: targetCount }, (_, i) => ({
    symbolId: `src/app.ts#f${i + 1}`,
    qualifiedName: `f${i + 1}`,
    kind: "function" as const,
    signature: `function f${i + 1}()`,
    range: { startLine: i + 1, endLine: i + 1 },
    executableLines: 3,
    coveredLines: 0,
    coveragePct: 0,
    changedLines: [i + 1],
    complexity: 2,
    score: 5 - i,
  }));

  const contextPacket = {
    schemaVersion: 1,
    fileId: "app_12345678",
    language: "javascript",
    framework: "vitest",
    mockingLibs: ["vi (vitest)"],
    conventions: {
      testNaming: "it('should ...')",
      assertionStyle: "expect(x).toBe(y)",
      importHint: 'import { f1 } from "../src/app";',
      testPath: "test/app.test.ts",
    },
    sourceFile: { path: "src/app.ts", content: sourceContent, truncated: false },
    targets: symbols.map((s) => ({
      symbolId: s.symbolId,
      qualifiedName: s.qualifiedName,
      signature: s.signature,
      startLine: s.range.startLine,
      endLine: s.range.endLine,
    })),
    referencedSignatures: [],
  };
  writeFileSync(path.join(contextsDir, "app_12345678.json"), JSON.stringify(contextPacket), "utf8");

  const manifest = {
    schemaVersion: 1,
    runId: "r1",
    repo: "acme/app",
    pr: 1,
    baseSha: "base1",
    headSha: "head1",
    createdAt: new Date().toISOString(),
    baseline: { status: "no_coverage", perLanguage: {}, patchCoveragePct: null },
    files: [
      {
        fileId: "app_12345678",
        language: "javascript",
        path: "src/app.ts",
        testPath: "test/app.test.ts",
        importHint: 'import { f1 } from "../src/app";',
        contextPath: "contexts/app_12345678.json",
        sourceSha256: sourceSha,
        symbols,
      },
    ],
    warnings: [],
    skipped: [],
  };
  writeFileSync(path.join(prepareDir, "manifest.json"), JSON.stringify(manifest), "utf8");

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
    },
  });

  return { workDir, cfg };
}

describe("generate stage & LLM isolation", () => {
  it("retries once on TruncatedOutputError with ceil(N/2) symbols (F9) and adds provenance header", async () => {
    const dir = makeTempDir();
    const { workDir, cfg } = setupManifestFixture(dir, 3);
    const seenTargetCounts: number[] = [];

    const fake = FakeLlmClient.fromHandler(({ context, attempt }) => {
      seenTargetCounts.push(context.targets.length);
      if (attempt === 1) {
        return { content: "", simulateTruncation: true };
      }
      return {
        content: 'import { expect, it } from "vitest";\nit("works", () => { expect(1).toBe(1); });',
        symbolIds: context.targets.map((t) => t.symbolId),
      };
    });

    const proposed = await runGenerate({
      repoRoot: dir,
      workDir,
      config: cfg,
      llmClient: fake,
      writeOutputs: false,
    });

    expect(seenTargetCounts).toEqual([3, 2]); // ceil(3/2) === 2
    expect(proposed.files).toHaveLength(1);
    expect(proposed.files[0]?.status).toBe("ok");
    expect(proposed.files[0]?.usage?.requests).toBe(2);
    expect(proposed.files[0]?.content.startsWith("// unit-agent:generated")).toBe(true);
  });

  it("throws AuthError (exit 40) when COPILOT_GITHUB_TOKEN is absent or SDK reports 401", async () => {
    const dir = makeTempDir();
    const { workDir, cfg } = setupManifestFixture(dir, 1);

    const prevToken = process.env.COPILOT_GITHUB_TOKEN;
    delete process.env.COPILOT_GITHUB_TOKEN;
    try {
      await expect(
        runGenerate({
          repoRoot: dir,
          workDir,
          config: cfg,
          writeOutputs: false,
        }),
      ).rejects.toMatchObject({ code: EXIT_CODES.SDK_OR_AUTH });
    } finally {
      if (prevToken !== undefined) process.env.COPILOT_GITHUB_TOKEN = prevToken;
    }

    const fakeAuthErr = FakeLlmClient.fromHandler(() => ({
      content: "",
      simulateAuthError: true,
    }));
    await expect(
      runGenerate({
        repoRoot: dir,
        workDir,
        config: cfg,
        llmClient: fakeAuthErr,
        writeOutputs: false,
      }),
    ).rejects.toMatchObject({ code: EXIT_CODES.SDK_OR_AUTH });

    expect(
      isAuthErrorMessage("Authorization error. Your credentials may be expired or invalid. (Request ID: ABC)"),
    ).toBe(true);
    expect(isAuthErrorMessage("Model did not invoke submit_tests tool")).toBe(false);
  });

  it("supports --dry-run without network token or LLM calls", async () => {
    const dir = makeTempDir();
    const { workDir, cfg } = setupManifestFixture(dir, 2);

    const proposed = await runGenerate({
      repoRoot: dir,
      workDir,
      config: cfg,
      dryRun: true,
      writeOutputs: false,
    });

    expect(proposed.files).toEqual([]);
    const status = JSON.parse(readFileSync(path.join(workDir, "generate", "status.json"), "utf8"));
    expect(status.reason).toBe("dry_run");
  });
});
