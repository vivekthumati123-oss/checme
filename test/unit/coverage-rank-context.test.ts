import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ConfigSchema } from "../../src/contracts";
import { buildFileContextPacket, checkNeverSend, computeImportHint, resolvePythonRoots } from "../../src/core/context";
import {
  computePatchCoverage,
  mapSymbolsToCoverage,
  normalizeCoverageContent,
  parseCoverageFile,
} from "../../src/core/coverage";
import { parseSourceFile } from "../../src/core/parse";
import { rankAndSelectSymbols } from "../../src/core/rank";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ua-cov-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("coverage parsers & normalization", () => {
  it("normalizes LCOV paths across repo root and disposable copy root", () => {
    const repoRoot = makeTempDir();
    const copyRoot = path.join(repoRoot, "tmp-copy-123");
    const lcov = [
      "TN:",
      `SF:${path.join(copyRoot, "packages", "web", "src", "math.ts")}`,
      "DA:10,2",
      "DA:11,0",
      "DA:12,1",
      "end_of_record",
    ].join("\n");

    const map = normalizeCoverageContent({
      format: "lcov",
      content: lcov,
      repoRoot,
      copyRoot,
      knownSourceFiles: ["packages/web/src/math.ts"],
    });

    const lines = map.get("packages/web/src/math.ts");
    expect(lines?.get(10)).toBe(2);
    expect(lines?.get(11)).toBe(0);
    expect(lines?.get(12)).toBe(1);
  });

  it("parses Cobertura XML safely (XXE disabled) and computes patch coverage", () => {
    const repoRoot = makeTempDir();
    const xml = `<?xml version="1.0" ?>
<coverage>
  <sources><source>${repoRoot}/backend/src</source></sources>
  <packages>
    <package name="billing">
      <classes>
        <class filename="tax.py">
          <lines>
            <line number="5" hits="1"/>
            <line number="6" hits="0"/>
            <line number="7" hits="2"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>`;

    const map = normalizeCoverageContent({
      format: "cobertura",
      content: xml,
      repoRoot,
      knownSourceFiles: ["backend/src/tax.py"],
    });

    expect(map.get("backend/src/tax.py")?.get(5)).toBe(1);
    expect(map.get("backend/src/tax.py")?.get(6)).toBe(0);

    const changed = new Map<string, Set<number>>([["backend/src/tax.py", new Set([5, 6])]]);
    const patch = computePatchCoverage({ changedLinesByFile: changed, coverageMap: map });
    expect(patch.totalChangedExecutableLines).toBe(2);
    expect(patch.coveredChangedLines).toBe(1);
    expect(patch.patchCoveragePct).toBe(50);
  });

  it("parses JaCoCo XML and joins package + sourcefile with known module paths", () => {
    const repoRoot = makeTempDir();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<report name="core">
  <package name="com/acme/pay">
    <sourcefile name="Calculator.java">
      <line nr="12" mi="0" ci="4" mb="0" cb="0"/>
      <line nr="13" mi="2" ci="0" mb="0" cb="0"/>
    </sourcefile>
  </package>
</report>`;

    const map = normalizeCoverageContent({
      format: "jacoco",
      content: xml,
      repoRoot,
      workingDirectory: "services/billing",
      knownSourceFiles: ["services/billing/src/main/java/com/acme/pay/Calculator.java"],
    });

    const lines = map.get("services/billing/src/main/java/com/acme/pay/Calculator.java");
    expect(lines?.get(12)).toBe(1);
    expect(lines?.get(13)).toBe(0);
  });

  it("handles missing coverage file (X1) with null & estimated AST fallback", async () => {
    const repoRoot = makeTempDir();
    expect(
      parseCoverageFile({
        filePath: "coverage/does-not-exist.info",
        format: "lcov",
        repoRoot,
      }),
    ).toBeNull();

    const parsed = await parseSourceFile({
      filePath: "src/calc.ts",
      content: "export function add(a: number, b: number) {\n  if (a < 0) return 0;\n  return a + b;\n}\n",
    });
    const mapped = mapSymbolsToCoverage({
      symbols: parsed.eligibleSymbols,
      changedLines: new Set([2, 3]),
      lineCoverage: undefined,
    });
    expect(mapped[0]?.estimated).toBe(true);
    expect(mapped[0]?.coveragePct).toBe(0);
    expect(mapped[0]?.executableLines).toBeGreaterThanOrEqual(2);
  });
});

describe("ranking and caps", () => {
  it("scores, tie-breaks deterministically, and enforces symbol/file caps", () => {
    const makeSym = (id: string, complexity: number, covPct: number) => ({
      symbol: {
        symbolId: id,
        qualifiedName: id.split("#")[1] ?? id,
        kind: "function" as const,
        signature: `function ${id}()`,
        startLine: 1,
        endLine: 10,
        complexity,
        executableLinesFallback: 5,
        exported: true,
        abstract: false,
        trivial: false,
        isTest: false,
      },
      executableLines: 5,
      coveredLines: Math.round((covPct / 100) * 5),
      coveragePct: covPct,
      estimated: false,
      changedLines: [2, 3, 4],
    });

    const res = rankAndSelectSymbols({
      candidates: [
        { filePath: "src/b.ts", language: "javascript", mapped: makeSym("src/b.ts#low", 1, 80) },
        { filePath: "src/a.ts", language: "javascript", mapped: makeSym("src/a.ts#high", 8, 0) },
        { filePath: "src/c.ts", language: "javascript", mapped: makeSym("src/c.ts#extra", 4, 20) },
      ],
      maxFilesPerPr: 2,
      maxSymbolsPerPr: 2,
    });

    expect(res.selectedFiles.map((f) => f.filePath)).toEqual(["src/a.ts", "src/c.ts"]);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0]?.reason).toBe("over_file_cap");
  });
});

describe("context builder, never-send, and import hints", () => {
  it("blocks never-send globs and secret-like content (X2)", () => {
    expect(checkNeverSend(".env.production", "PORT=3000").blocked).toBe(true);
    expect(checkNeverSend("config/custom.yaml", "a: 1", ["config/**"]).blocked).toBe(true);
    const secretHit = checkNeverSend("src/auth.ts", 'export const gh = "ghp_1234567890abcdefghijklmnop";');
    expect(secretHit).toMatchObject({ blocked: true, reason: "secret_like_content" });
  });

  it("resolves Python roots from pyproject.toml src layout and computes import hints (X6)", () => {
    const dir = makeTempDir();
    mkdirSync(path.join(dir, "pkg", "src", "billing"), { recursive: true });
    writeFileSync(path.join(dir, "pkg", "pyproject.toml"), '[tool.pytest.ini_options]\npythonpath = ["src"]\n', "utf8");

    const roots = resolvePythonRoots({ repoRoot: dir, workingDirectory: "pkg" });
    expect(roots[0]).toBe("pkg/src");

    const hint = computeImportHint({
      language: "python",
      repoRoot: dir,
      workingDirectory: "pkg",
      sourcePath: "pkg/src/billing/tax.py",
      testPath: "pkg/tests/test_tax.py",
    });
    expect(hint).toBe("from billing.tax import ...");
  });

  it("caps source slice to maxContextChars (X5)", async () => {
    const dir = makeTempDir();
    mkdirSync(path.join(dir, "src"), { recursive: true });
    const cfg = ConfigSchema.parse({
      version: 1,
      limits: { maxContextChars: 1200 },
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
    const bigBody = Array.from({ length: 120 }, (_, i) => `  const v${i} = ${i};`).join("\n");
    const content = `export function bigFn(x: number): number {\n  if (x < 0) return 0;\n${bigBody}\n  return x;\n}\n`;
    const parsed = await parseSourceFile({ filePath: "src/big.ts", content });

    const ctx = await buildFileContextPacket({
      repoRoot: dir,
      config: cfg,
      fileId: "big_deadbeef",
      language: "javascript",
      sourcePath: "src/big.ts",
      testPath: "test/big.test.ts",
      sourceContent: content,
      symbols: [
        {
          symbolId: parsed.eligibleSymbols[0]!.symbolId,
          qualifiedName: "bigFn",
          kind: "function",
          signature: parsed.eligibleSymbols[0]!.signature,
          range: { startLine: 1, endLine: 124 },
          executableLines: 122,
          coveredLines: 0,
          coveragePct: 0,
          changedLines: [2],
          complexity: 2,
          score: 5,
        },
      ],
      allParsedSymbols: parsed.allSymbols,
      imports: [],
    });

    expect(ctx.sourceFile.truncated).toBe(true);
    expect(ctx.sourceFile.content.length).toBeLessThanOrEqual(1200);
  });
});
