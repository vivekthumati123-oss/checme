import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ConfigSchema, type GitHubClientLike } from "../../src/contracts";
import { sha256Hex } from "../../src/core/context";
import { runStaticPolicyCheck } from "../../src/core/policy";
import { deriveFinalContent, pruneFailingTests } from "../../src/core/prune";
import { FakeLlmClient } from "../../src/llm";
import { runPublish } from "../../src/stages/publish";
import { runRepair } from "../../src/stages/repair";
import { runValidate } from "../../src/stages/validate";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ua-val-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("static AST policy gate (T17 & X9)", () => {
  it("blocks banned imports, focus modifiers (.only), tautologies, and mocking unit under test in JS", async () => {
    const res = await runStaticPolicyCheck({
      language: "javascript",
      testPath: "test/calc.test.ts",
      importHint: 'import { add } from "../src/calc";',
      content: `
import fs from "node:fs";
import { expect, it, vi } from "vitest";
vi.mock("../src/calc");
it.only("tautology", () => {
  expect(true).toBe(true);
});
`,
    });

    expect(res.ok).toBe(false);
    const rules = res.violations.map((v) => v.rule);
    expect(rules).toContain("banned_import");
    expect(rules).toContain("focus_or_skip");
    expect(rules).toContain("mock_unit_under_test");
    expect(rules).toContain("tautological_assertion");
  });

  it("enforces extraBannedImports and Python/Java rules", async () => {
    const pyRes = await runStaticPolicyCheck({
      language: "python",
      testPath: "tests/test_tax.py",
      extraBannedImports: { python: ["sqlite3"] },
      content: `
import sqlite3
def test_bad():
    assert True
`,
    });
    expect(pyRes.ok).toBe(false);
    expect(pyRes.violations.map((v) => v.rule)).toContain("banned_import");
    expect(pyRes.violations.map((v) => v.rule)).toContain("tautological_assertion");

    const javaRes = await runStaticPolicyCheck({
      language: "java",
      testPath: "src/test/java/com/acme/CalcTest.java",
      importHint: "package com.acme;\nimport com.acme.Calc;",
      content: `
package com.acme;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
public class WrongNameTest {
  @Test
  void shouldWork() {
    assertEquals(4, 2 + 2);
  }
}
`,
    });
    expect(javaRes.ok).toBe(false);
    expect(javaRes.violations.map((v) => v.rule)).toContain("java_classname_mismatch");
  });
});

describe("AST pruning and D25 deriveFinalContent", () => {
  it("prunes failing JS, Python, and Java test cases cleanly", async () => {
    const js = [
      'import { expect, it } from "vitest";',
      'it("passes one", () => { expect(1 + 1).toBe(2); });',
      'it("fails two", () => { expect(1 + 1).toBe(3); });',
    ].join("\n");

    const jsPruned = await pruneFailingTests({
      language: "javascript",
      testPath: "test/a.test.ts",
      content: js,
      failingTestNames: ["Suite > fails two"],
    });
    expect(jsPruned.keptCount).toBe(1);
    expect(jsPruned.droppedCount).toBe(1);
    expect(jsPruned.prunedContent).toContain("passes one");
    expect(jsPruned.prunedContent).not.toContain("fails two");

    const dir = makeTempDir();
    const derived = await deriveFinalContent({
      language: "python",
      testPath: "tests/test_calc.py",
      content: "def test_ok():\n    assert 1 == 1\n\ndef test_bad():\n    assert 1 == 2\n",
      failingTestNames: ["tests/test_calc.py::test_bad"],
      repoRoot: dir,
      configEol: "lf",
      provenanceHeader: true,
    });
    expect(derived.keptCount).toBe(1);
    expect(derived.content.startsWith("# unit-agent:generated")).toBe(true);
    expect(derived.content).not.toContain("test_bad");
  });
});

describe("validate, repair, and publish flow", () => {
  it("runs static validation, repairs failure once, re-validates, and enforces F3 in publish", async () => {
    const dir = makeTempDir();
    mkdirSync(path.join(dir, "src"), { recursive: true });
    mkdirSync(path.join(dir, ".unit-agent", "prepare", "contexts"), { recursive: true });
    mkdirSync(path.join(dir, ".unit-agent", "generate"), { recursive: true });

    const srcContent = "export function add(a: number, b: number) {\n  if (a < 0) return 0;\n  return a + b;\n}\n";
    writeFileSync(path.join(dir, "src", "math.ts"), srcContent, "utf8");
    const srcSha = sha256Hex(srcContent);
    const workDir = path.join(dir, ".unit-agent");

    const cfg = ConfigSchema.parse({
      version: 1,
      mode: "propose",
      validate: { workspace: "copy" },
      languages: {
        javascript: {
          testCommand: "node -e process.exit(0)",
          coverageFile: "coverage/lcov.info",
          coverageFormat: "lcov",
          sourceGlobs: ["src/**/*.ts"],
          testPathPatterns: ["test/{name}.test.{ext}"],
        },
      },
    });

    const ctxPacket = {
      schemaVersion: 1,
      fileId: "math_1",
      language: "javascript",
      framework: "vitest",
      mockingLibs: [],
      conventions: {
        testNaming: "it('...')",
        assertionStyle: "expect(...)",
        importHint: 'import { add } from "../src/math";',
        testPath: "test/math.test.ts",
      },
      sourceFile: { path: "src/math.ts", content: srcContent, truncated: false },
      targets: [
        {
          symbolId: "src/math.ts#add",
          qualifiedName: "add",
          signature: "function add(a, b)",
          startLine: 1,
          endLine: 4,
        },
      ],
      referencedSignatures: [],
    };
    writeFileSync(path.join(workDir, "prepare", "contexts", "math_1.json"), JSON.stringify(ctxPacket), "utf8");

    const manifest = {
      schemaVersion: 1,
      runId: "run-99",
      repo: "acme/app",
      pr: 7,
      baseSha: "base0",
      headSha: "head0",
      createdAt: new Date().toISOString(),
      baseline: { status: "no_coverage", perLanguage: {}, patchCoveragePct: null },
      files: [
        {
          fileId: "math_1",
          language: "javascript",
          path: "src/math.ts",
          testPath: "test/math.test.ts",
          importHint: 'import { add } from "../src/math";',
          contextPath: "contexts/math_1.json",
          sourceSha256: srcSha,
          symbols: [
            {
              symbolId: "src/math.ts#add",
              qualifiedName: "add",
              kind: "function",
              signature: "function add(a, b)",
              range: { startLine: 1, endLine: 4 },
              executableLines: 3,
              coveredLines: 0,
              coveragePct: 0,
              changedLines: [2, 3],
              complexity: 2,
              score: 5,
            },
          ],
        },
      ],
      warnings: [],
      skipped: [],
    };
    writeFileSync(path.join(workDir, "prepare", "manifest.json"), JSON.stringify(manifest), "utf8");

    // Syntax error triggers needs_repair in static validate
    const brokenTest = 'import { add } from "../src/math";\nit("broken", () => { expect(add(1,2)).toBe(';
    const proposed = {
      schemaVersion: 1,
      runId: "run-99",
      headSha: "head0",
      model: "gpt",
      files: [
        {
          fileId: "math_1",
          testPath: "test/math.test.ts",
          content: brokenTest,
          sha256: sha256Hex(brokenTest),
          symbolIds: ["src/math.ts#add"],
          assumptions: [],
          status: "ok",
        },
      ],
    };
    writeFileSync(path.join(workDir, "generate", "proposed.json"), JSON.stringify(proposed), "utf8");

    const v1 = await runValidate({
      repoRoot: dir,
      workDir,
      config: cfg,
      phase: "static",
      attempt: 1,
      writeOutputs: false,
    });
    expect(v1.report.files[0]?.outcome).toBe("needs_repair");
    expect(v1.failures.files).toHaveLength(1);

    const repairFake = FakeLlmClient.fromHandler(() => ({
      content: [
        'import { expect, it } from "vitest";',
        'import { add } from "../src/math";',
        'it("adds positive numbers", () => {',
        "  expect(add(2, 3)).toBe(5);",
        "});",
      ].join("\n"),
    }));

    const repaired = await runRepair({
      repoRoot: dir,
      workDir,
      config: cfg,
      llmClient: repairFake,
      writeOutputs: false,
    });
    expect(repaired.files[0]?.status).toBe("ok");

    const v2 = await runValidate({
      repoRoot: dir,
      workDir,
      config: cfg,
      phase: "all",
      attempt: 2,
      writeOutputs: false,
    });
    expect(v2.report.files[0]?.outcome).toBe("accepted");
    expect(v2.finalArtifact.files).toHaveLength(1);

    // Mock GitHub client where unit-agent-approve has NO required reviewers -> F3 downgrades to report
    const comments: Array<{ id: number; body: string; userLogin: string }> = [];
    const fakeGh: GitHubClientLike = {
      getPullRequest: async () => ({
        headSha: "head0",
        headRef: "feat/x",
        headRepoFullName: "acme/app",
        baseRepoFullName: "acme/app",
        draft: false,
        authorLogin: "alice",
        authorType: "User",
        labels: [],
        headCommitMessage: "feat",
      }),
      listIssueComments: async () => comments,
      createIssueComment: async (_o, _r, _p, body) => {
        comments.push({ id: 101, body, userLogin: "github-actions[bot]" });
        return { id: 101 };
      },
      updateIssueComment: async (_o, _r, id, body) => {
        const hit = comments.find((c) => c.id === id);
        if (hit) hit.body = body;
      },
      getEnvironment: async () => ({ exists: true, status: 200, hasRequiredReviewers: false }),
      getRunApprovals: async () => [],
      createCommitOnBranch: async () => ({ oid: "newcommit" }),
    };

    const pubRes = await runPublish({
      repoRoot: dir,
      workDir,
      config: cfg,
      github: fakeGh,
      jobResults: { prepare: "success", validate_1: "failure" },
      writeOutputs: false,
    });

    expect(pubRes.finalArtifact.mode).toBe("report"); // F3 downgraded!
    expect(pubRes.markdown).toContain("unit-agent:v1 sha=head0");
    expect(pubRes.markdown).toContain("Incomplete Run");
    expect(comments).toHaveLength(1);
    const savedFinal = JSON.parse(readFileSync(path.join(workDir, "final", "final.json"), "utf8"));
    expect(savedFinal.mode).toBe("report");
  });

  it("preserves previously accepted final.json entries on multi-repair attempt >= 3", async () => {
    const dir = makeTempDir();
    const workDir = path.join(dir, ".unit-agent");
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "src", "math.ts"), "export function add(a: number, b: number) { return a + b; }\n");
    writeFileSync(path.join(dir, "src", "calc.ts"), "export function sub(a: number, b: number) { return a - b; }\n");

    const cfg = ConfigSchema.parse({
      version: 1,
      mode: "report",
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

    mkdirSync(path.join(workDir, "prepare"), { recursive: true });
    const manifest = {
      schemaVersion: 1,
      runId: "run-multi-3",
      repo: "acme/app",
      pr: 8,
      baseSha: "base0",
      headSha: "head0",
      createdAt: new Date().toISOString(),
      baseline: { status: "no_coverage", perLanguage: {}, patchCoveragePct: null },
      files: [
        {
          fileId: "math_1",
          language: "javascript",
          path: "src/math.ts",
          testPath: "test/math.test.ts",
          importHint: 'import { add } from "../src/math";',
          contextPath: "contexts/math_1.json",
          sourceSha256: sha256Hex("export function add(a: number, b: number) { return a + b; }\n"),
          symbols: [
            {
              symbolId: "src/math.ts#add",
              qualifiedName: "add",
              kind: "function",
              signature: "function add(a, b)",
              range: { startLine: 1, endLine: 1 },
              executableLines: 1,
              coveredLines: 0,
              coveragePct: 0,
              changedLines: [1],
              complexity: 1,
              score: 5,
            },
          ],
        },
        {
          fileId: "calc_1",
          language: "javascript",
          path: "src/calc.ts",
          testPath: "test/calc.test.ts",
          importHint: 'import { sub } from "../src/calc";',
          contextPath: "contexts/calc_1.json",
          sourceSha256: sha256Hex("export function sub(a: number, b: number) { return a - b; }\n"),
          symbols: [
            {
              symbolId: "src/calc.ts#sub",
              qualifiedName: "sub",
              kind: "function",
              signature: "function sub(a, b)",
              range: { startLine: 1, endLine: 1 },
              executableLines: 1,
              coveredLines: 0,
              coveragePct: 0,
              changedLines: [1],
              complexity: 1,
              score: 5,
            },
          ],
        },
      ],
      warnings: [],
      skipped: [],
    };
    writeFileSync(path.join(workDir, "prepare", "manifest.json"), JSON.stringify(manifest), "utf8");

    const mathTest =
      'import { expect, it } from "vitest";\nimport { add } from "../src/math";\nit("adds", () => { expect(add(1, 2)).toBe(3); });\n';
    const calcTest =
      'import { expect, it } from "vitest";\nimport { sub } from "../src/calc";\nit("subs", () => { expect(sub(3, 1)).toBe(2); });\n';

    mkdirSync(path.join(workDir, "generate"), { recursive: true });
    writeFileSync(
      path.join(workDir, "generate", "proposed.json"),
      JSON.stringify({
        schemaVersion: 1,
        runId: "run-multi-3",
        headSha: "head0",
        model: "gpt",
        files: [
          {
            fileId: "math_1",
            testPath: "test/math.test.ts",
            content: mathTest,
            sha256: sha256Hex(mathTest),
            symbolIds: ["src/math.ts#add"],
            assumptions: [],
            status: "ok",
          },
        ],
      }),
      "utf8",
    );

    const v1 = await runValidate({
      repoRoot: dir,
      workDir,
      config: cfg,
      phase: "static",
      attempt: 1,
      writeOutputs: false,
    });
    expect(v1.finalArtifact.files.map((f) => f.path)).toEqual(["test/math.test.ts"]);

    mkdirSync(path.join(workDir, "repair"), { recursive: true });
    writeFileSync(
      path.join(workDir, "repair", "repaired.json"),
      JSON.stringify({
        schemaVersion: 1,
        runId: "run-multi-3",
        headSha: "head0",
        model: "gpt",
        files: [
          {
            fileId: "calc_1",
            testPath: "test/calc.test.ts",
            content: calcTest,
            sha256: sha256Hex(calcTest),
            symbolIds: ["src/calc.ts#sub"],
            assumptions: [],
            status: "ok",
          },
        ],
      }),
      "utf8",
    );

    const v3 = await runValidate({
      repoRoot: dir,
      workDir,
      config: cfg,
      phase: "static",
      attempt: 3,
      local: true,
      writeOutputs: false,
    });
    expect(v3.finalArtifact.files.map((f) => f.path).sort()).toEqual(["test/calc.test.ts", "test/math.test.ts"]);
  });
});
