import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { ConfigSchema } from "../../../../../../agents/node/testgen/src/contracts";
import { normalizeCoverageContent } from "../../../../../../agents/node/testgen/src/core/coverage";
import { parseUnifiedDiff } from "../../../../../../agents/node/testgen/src/core/git";
import { parseSourceFile } from "../../../../../../agents/node/testgen/src/core/parse";
import { buildLanguageToolVersions } from "../../../../../../agents/node/testgen/src/languages/toolchains";
import { extractTestRulesBlock, renderGenerationPrompt } from "../../../../../../agents/node/testgen/src/llm";
import { runInitChat } from "../../../../../../agents/node/testgen/src/local/init-chat";
import { renderPublishSummaryMarkdown } from "../../../../../../agents/node/testgen/src/stages/publish";
import { classifyExecutionFailure } from "../../../../../../agents/node/testgen/src/stages/validate/classify";
import { sanitizeOutput } from "../../../../../../agents/node/testgen/src/telemetry";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../..");
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("Golden suite (Step 10.2 / fixtures)", () => {
  it("parses every diff fixture cleanly including pure deletion, binary, submodule, and renames", () => {
    const simpleAdd = parseUnifiedDiff(
      readFileSync(path.join(REPO_ROOT, "agents/node/testgen/fixtures/diffs/simple-add.diff"), "utf8"),
    );
    expect(simpleAdd["src/math.ts"]).toEqual([1, 2, 3, 4, 5]);

    const modifyLines = parseUnifiedDiff(
      readFileSync(path.join(REPO_ROOT, "agents/node/testgen/fixtures/diffs/modify-lines.diff"), "utf8"),
    );
    expect(modifyLines["src/calc.ts"]).toEqual([11, 12, 13, 21, 22]);

    const renameEdit = parseUnifiedDiff(
      readFileSync(path.join(REPO_ROOT, "agents/node/testgen/fixtures/diffs/rename-with-edit.diff"), "utf8"),
    );
    expect(renameEdit["src/oldName.ts"]).toBeUndefined();
    expect(renameEdit["src/newName.ts"]).toEqual([4, 5, 6]);

    const deleteOnly = parseUnifiedDiff(
      readFileSync(path.join(REPO_ROOT, "agents/node/testgen/fixtures/diffs/delete-only.diff"), "utf8"),
    );
    expect(deleteOnly["src/obsolete.ts"]).toBeUndefined();
    expect(deleteOnly["src/calc.ts"] ?? []).toEqual([]);

    const binaryText = parseUnifiedDiff(
      readFileSync(path.join(REPO_ROOT, "agents/node/testgen/fixtures/diffs/binary-and-text.diff"), "utf8"),
    );
    expect(binaryText["assets/logo.png"]).toBeUndefined();
    expect(binaryText["src/formatter.ts"]).toEqual([3, 4]);

    const submod = parseUnifiedDiff(
      readFileSync(path.join(REPO_ROOT, "agents/node/testgen/fixtures/diffs/submodule-change.diff"), "utf8"),
    );
    expect(submod["src/service.ts"]).toEqual([9, 10]);

    const crlf = parseUnifiedDiff(
      readFileSync(path.join(REPO_ROOT, "agents/node/testgen/fixtures/diffs/crlf-file.diff"), "utf8"),
    );
    expect(crlf["src/crlf.ts"]).toEqual([2, 3, 4]);

    const huge = parseUnifiedDiff(
      readFileSync(path.join(REPO_ROOT, "agents/node/testgen/fixtures/diffs/huge-generated.diff"), "utf8"),
    );
    expect(huge["dist/generated.bundle.js"]?.length).toBe(200);
    expect(huge["src/kept.ts"]).toEqual([2, 3]);
  });

  it("extracts golden AST symbols for JS/TS, Python, and Java fixtures", async () => {
    const cases: Array<{
      language: "javascript" | "python" | "java";
      filePath: string;
      srcRel: string;
      goldenRel: string;
    }> = [
      {
        language: "javascript",
        filePath: "src/js/sample.ts",
        srcRel: "agents/node/testgen/fixtures/src/js/sample.ts",
        goldenRel: "agents/node/testgen/fixtures/src/js/sample.symbols.json",
      },
      {
        language: "python",
        filePath: "src/python/sample.py",
        srcRel: "agents/node/testgen/fixtures/src/python/sample.py",
        goldenRel: "agents/node/testgen/fixtures/src/python/sample.symbols.json",
      },
      {
        language: "java",
        filePath: "src/java/SampleService.java",
        srcRel: "agents/node/testgen/fixtures/src/java/SampleService.java",
        goldenRel: "agents/node/testgen/fixtures/src/java/SampleService.symbols.json",
      },
    ];

    for (const c of cases) {
      const content = readFileSync(path.join(REPO_ROOT, c.srcRel), "utf8");
      const golden = JSON.parse(readFileSync(path.join(REPO_ROOT, c.goldenRel), "utf8"));
      const parsed = await parseSourceFile({ filePath: c.filePath, content, language: c.language });
      expect(parsed).toEqual(golden);
    }
  });

  it("normalizes lcov, Cobertura, and JaCoCo coverage fixtures to golden JSON", () => {
    const mapToRecord = (m: Map<string, Map<number, number>>): Record<string, Record<string, number>> => {
      const obj: Record<string, Record<string, number>> = {};
      for (const [file, lines] of m.entries()) {
        const rec: Record<string, number> = {};
        for (const [ln, hits] of lines.entries()) {
          rec[String(ln)] = hits;
        }
        obj[file] = rec;
      }
      return obj;
    };

    const lcovActual = mapToRecord(
      normalizeCoverageContent({
        format: "lcov",
        content: readFileSync(path.join(REPO_ROOT, "agents/node/testgen/fixtures/coverage/sample.lcov"), "utf8"),
        repoRoot: REPO_ROOT,
      }),
    );
    expect(lcovActual).toEqual(
      JSON.parse(readFileSync(path.join(REPO_ROOT, "agents/node/testgen/fixtures/coverage/sample.lcov.json"), "utf8")),
    );

    const cobActual = mapToRecord(
      normalizeCoverageContent({
        format: "cobertura",
        content: readFileSync(
          path.join(REPO_ROOT, "agents/node/testgen/fixtures/coverage/sample.cobertura.xml"),
          "utf8",
        ),
        repoRoot: REPO_ROOT,
        knownSourceFiles: ["billing/sample.py"],
      }),
    );
    expect(cobActual).toEqual(
      JSON.parse(
        readFileSync(path.join(REPO_ROOT, "agents/node/testgen/fixtures/coverage/sample.cobertura.json"), "utf8"),
      ),
    );

    const jacocoActual = mapToRecord(
      normalizeCoverageContent({
        format: "jacoco",
        content: readFileSync(path.join(REPO_ROOT, "agents/node/testgen/fixtures/coverage/sample.jacoco.xml"), "utf8"),
        repoRoot: REPO_ROOT,
        knownSourceFiles: ["src/main/java/com/example/alpha/Utils.java", "src/main/java/com/example/beta/Utils.java"],
      }),
    );
    expect(jacocoActual).toEqual(
      JSON.parse(
        readFileSync(path.join(REPO_ROOT, "agents/node/testgen/fixtures/coverage/sample.jacoco.json"), "utf8"),
      ),
    );
  });

  it("sanitizes secret-leak fixture to golden sanitized output and classifies failure logs", () => {
    const rawLeak = readFileSync(path.join(REPO_ROOT, "agents/node/testgen/fixtures/logs/secret-leak.txt"), "utf8");
    const expectedClean = readFileSync(
      path.join(REPO_ROOT, "agents/node/testgen/fixtures/logs/secret-leak.sanitized.txt"),
      "utf8",
    )
      .replace(/\r\n/g, "\n")
      .trimEnd();
    const actualClean = sanitizeOutput(rawLeak, { repoRoot: "C:\\workspace\\secret-repo" })
      .replace(/\r\n/g, "\n")
      .trimEnd();
    expect(actualClean).toBe(expectedClean);

    for (const logFile of [
      "jest-fail.txt",
      "vitest-fail.txt",
      "pytest-fail.txt",
      "maven-surefire-fail.txt",
      "gradle-fail.txt",
    ]) {
      const logBody = readFileSync(path.join(REPO_ROOT, "agents/node/testgen/fixtures/logs", logFile), "utf8");
      const res = classifyExecutionFailure({
        commandString: "runner",
        exitCode: 1,
        stdout: logBody,
        stderr: "",
        all: logBody,
        timedOut: false,
        notes: [],
      });
      expect(res.reason).toBe("generated_test_failure");
    }
  });

  it("renders golden PR summary markdown with sanitization and truncation, and chat templates with zero placeholders", async () => {
    const sha = "a".repeat(40);
    const md = renderPublishSummaryMarkdown({
      finalArtifact: {
        schemaVersion: 1,
        runId: "run-golden",
        repo: "org/repo",
        pr: 12,
        headSha: sha,
        headRef: "feat/math",
        mode: "propose",
        patchCoverage: { beforePct: 25.0, projectedPct: 75.0, targetPct: 80.0 },
        toolVersions: {
          agentNode: process.versions.node,
          warnings: [],
          languages: {},
        },
        notes: [],
        files: [
          {
            path: "test/math.test.ts",
            sha256: "b".repeat(64),
            symbolIds: ["src/math.ts#add"],
            testCount: 1,
            assumptions: ["Avoids @org/team ping, issue #42 <script>alert(1)</script> [link](http://evil.test)"],
          },
        ],
        rejected: [{ testPath: "test/bad.test.ts", reason: "zero_gain" }],
      },
      report: {
        schemaVersion: 1,
        attempt: 1,
        workspace: "copy",
        environment: null,
        patchCoverage: { beforePct: 25.0, projectedPct: 75.0 },
        toolVersions: {
          agentNode: process.versions.node,
          warnings: [],
          languages: {},
        },
        notes: [],
        files: [
          {
            fileId: "f1",
            testPath: "test/math.test.ts",
            outcome: "accepted",
            gates: [{ gate: "path", status: "pass" }],
            tests: [{ name: "adds numbers", status: "pass" }],
            sha256: "b".repeat(64),
            coverage: {
              symbols: [{ symbolId: "src/math.ts#add", beforePct: 0, afterPct: 100 }],
              gainedLines: 4,
            },
          },
        ],
      },
      failedUpstreamJobs: [],
      approvalEnvironment: "unit-agent-approval",
    });

    expect(md).toContain(`<!-- unit-agent:v1 sha=${sha} -->`);
    expect(md).toContain("`propose`");
    expect(md).toContain("+50.0 pp");
    expect(md).toContain("unit-agent-approval");
    expect(md).not.toContain("<script>");

    // Also test prompt rendering with unresolved-placeholder & tag-escape checks
    const prompt = renderGenerationPrompt({
      maxTestsPerSymbol: 4,
      context: {
        schemaVersion: 1,
        fileId: "f1",
        language: "javascript",
        framework: "vitest",
        sourceFile: {
          path: "src/math.ts",
          content: "export const x = '</UNTRUSTED_CODE>';",
          truncated: false,
        },
        targets: [
          {
            symbolId: "src/math.ts#add",
            qualifiedName: "add",
            signature: "function add(a: number, b: number): number",
            startLine: 1,
            endLine: 3,
          },
        ],
        referencedSignatures: [],
        conventions: {
          testPath: "test/math.test.ts",
          importHint: "../src/math",
          testNaming: "describe/it",
          assertionStyle: "expect",
        },
        mockingLibs: [],
      },
    });
    expect(prompt).toContain("[redacted-tag]");
    expect(prompt).not.toMatch(/\{\{[a-zA-Z0-9_]+\}\}/);

    // Chat template rendering check via runInitChat
    const tmp = makeTempDir("ua-golden-chat-");
    const cfgRaw = readFileSync(
      path.join(REPO_ROOT, "agents/node/testgen/fixtures/repos/js-vitest/.unit-agent.yml"),
      "utf8",
    );
    writeFileSync(path.join(tmp, ".unit-agent.yml"), cfgRaw, "utf8");
    const cfg = ConfigSchema.parse(parseYaml(cfgRaw));
    await runInitChat({ repoRoot: tmp, workDir: path.join(tmp, ".unit-agent"), config: cfg });
    const renderedAgent = readFileSync(path.join(tmp, ".github/agents/unit-agent.agent.md"), "utf8");
    expect(renderedAgent).toContain(extractTestRulesBlock().replaceAll("{{maxTestsPerSymbol}}", "6"));
    expect(renderedAgent).not.toMatch(/\{\{[a-zA-Z0-9_]+\}\}/);

    // buildLanguageToolVersions smoke check on fixture repo
    const tv = buildLanguageToolVersions({
      repoRoot: path.join(REPO_ROOT, "agents/node/testgen/fixtures/repos/js-vitest"),
      config: cfg,
      language: "javascript",
    });
    expect(tv.framework?.name).toBe("vitest");
  });
});
