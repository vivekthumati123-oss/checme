import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../../src/cli";
import {
  ARTIFACTS,
  EXIT_CODES,
  FileContextSchema,
  LocalDetectSummarySchema,
  LocalValidateSummarySchema,
} from "../../src/contracts";
import { sha256Hex } from "../../src/core/context";
import { extractTestRulesBlock } from "../../src/llm";
import {
  MAX_LOCAL_SUMMARY_BYTES,
  normalizeSummaryPaths,
  recordPlacedFile,
  runInitChat,
  runLocalApply,
  runLocalDetect,
  runLocalDoctor,
  runLocalShow,
  runLocalStatus,
  runLocalValidate,
  serializeBoundedSummary,
} from "../../src/local";
import { runDetect } from "../../src/stages/detect";

const createdDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = path.join(os.tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  createdDirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function initGitRepo(dir: string): void {
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "unit-agent-test@example.com");
  git(dir, "config", "user.name", "Unit Agent Test");
  git(dir, "config", "core.autocrlf", "false");
}

function createFakeVitestRepo(opts: { includeTestsInVitestOutput?: boolean } = {}): string {
  const dir = makeTempDir("ua-local-");
  initGitRepo(dir);

  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  mkdirSync(path.join(dir, "test", "unit"), { recursive: true });

  writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name: "sample-local", version: "1.0.0", type: "module", devDependencies: { vitest: "^3.0.0" } }, null, 2)}\n`,
    "utf8",
  );

  writeFileSync(
    path.join(dir, ".unit-agent.yml"),
    `version: 1
mode: propose
languages:
  javascript:
    enabled: true
    framework: vitest
    testCommand: "node scripts/fake-vitest.mjs"
    coverageFile: "coverage/lcov.info"
    coverageFormat: "lcov"
    sourceGlobs: ["src/**/*.js"]
    testPathPatterns: ["test/unit/{name}.test.js"]
limits:
  minExecutableLines: 1
  flakeRuns: 1
baseline:
  mode: run
validate:
  workspace: copy
local:
  baseRef: main
  stagingDir: .unit-agent/chat/proposed
  reuseCoverage: true
  stageApplied: false
`,
    "utf8",
  );

  writeFileSync(
    path.join(dir, "scripts", "fake-vitest.mjs"),
    `import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const outFlag = args.find((a) => a.startsWith("--outputFile="));
const outPath = outFlag ? outFlag.slice("--outputFile=".length) : "";
const countFile = path.resolve(process.cwd(), ".baseline-runs");
const isSingle = args.some((a) => a.endsWith(".test.js"));

if (!isSingle) {
  const prev = existsSync(countFile) ? Number.parseInt(readFileSync(countFile, "utf8"), 10) || 0 : 0;
  writeFileSync(countFile, String(prev + 1), "utf8");
}

if (existsSync(path.resolve(process.cwd(), ".fail-tests"))) {
  process.stderr.write("Simulated environment_error failure\\n");
  process.exit(1);
}

mkdirSync(path.resolve(process.cwd(), "coverage"), { recursive: true });
if (isSingle) {
  writeFileSync(
    path.resolve(process.cwd(), "coverage", "lcov.info"),
    "SF:src/calc.js\\nDA:1,1\\nDA:2,1\\nDA:3,1\\nDA:6,1\\nDA:7,1\\nDA:8,1\\nend_of_record\\n",
    "utf8",
  );
  if (outPath) {
    writeFileSync(
      outPath,
      JSON.stringify({
        testResults: [
          {
            assertionResults: [
              { title: "adds numbers", fullName: "adds numbers", status: "passed" },
            ],
          },
        ],
      }),
      "utf8",
    );
  }
} else {
  writeFileSync(
    path.resolve(process.cwd(), "coverage", "lcov.info"),
    "SF:src/calc.js\\nDA:1,0\\nDA:2,0\\nDA:3,0\\nDA:6,0\\nDA:7,0\\nDA:8,0\\nend_of_record\\n",
    "utf8",
  );
  ${opts.includeTestsInVitestOutput ? "" : "// baseline run"}
}
`,
    "utf8",
  );

  writeFileSync(
    path.join(dir, "src", "calc.js"),
    `export function add(a, b) {
  const sum = a + b;
  return sum;
}

export function mul(a, b) {
  const prod = a * b;
  return prod;
}
`,
    "utf8",
  );

  writeFileSync(
    path.join(dir, "test", "unit", "smoke.test.js"),
    `import { describe, it, expect } from "vitest";
describe("smoke", () => {
  it("passes", () => {
    expect(1 + 1).toBe(2);
  });
});
`,
    "utf8",
  );

  git(dir, "add", ".");
  git(dir, "commit", "-m", "initial commit");
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Local IDE / Copilot Chat commands (Section 10.7)", () => {
  it("supports local detect scopes (staged, worktree, branch + merge-base + origin/HEAD fallback, files + wildcards + include-covered) and matches CI git-range parity", async () => {
    const repo = createFakeVitestRepo();
    const baseSha = git(repo, "rev-parse", "HEAD");

    // Set up origin/HEAD -> main fallback by creating a remote tracking ref without local main default override
    git(repo, "update-ref", "refs/remotes/origin/main", baseSha);
    git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");

    // Create a feature branch and advance main independently so merge-base differs from main HEAD
    git(repo, "checkout", "-b", "feat/calc");
    writeFileSync(
      path.join(repo, "src", "calc.js"),
      `export function add(a, b) {
  const res = a + b;
  return res;
}

export class Calculator {
  divide(a, b) {
    if (b === 0) throw new Error("zero");
    return a / b;
  }
  square(x) {
    return x * x;
  }
}
`,
      "utf8",
    );
    git(repo, "add", "src/calc.js");
    git(repo, "commit", "-m", "feat: add Calculator");
    const featHeadSha = git(repo, "rev-parse", "HEAD");

    // Advance main with an unrelated file so origin/HEAD advances past merge-base
    git(repo, "checkout", "main");
    writeFileSync(path.join(repo, "src", "unrelated.js"), "export function untouched() {\n  return 42;\n}\n", "utf8");
    git(repo, "add", "src/unrelated.js");
    git(repo, "commit", "-m", "main: unrelated change");
    git(repo, "update-ref", "refs/remotes/origin/main", git(repo, "rev-parse", "HEAD"));
    git(repo, "checkout", "feat/calc");

    const workDir = path.join(repo, ".unit-agent");

    // 1. Clean branch detect matches CI git-range parity and excludes main's unrelated.js via merge-base
    const branchRes = await runLocalDetect({
      repoRoot: repo,
      workDir,
      scope: "branch",
      baseRef: "main",
      skipBaseline: true,
    });
    expect(branchRes.manifest.files.map((f) => f.path)).toEqual(["src/calc.js"]);
    expect(branchRes.summary.files[0]?.symbols.map((s) => s.qualifiedName).sort()).toEqual([
      "Calculator.divide",
      "Calculator.square",
      "add",
    ]);

    const ciWorkDir = path.join(repo, ".ua-ci");
    const ciManifest = await runDetect({
      repoRoot: repo,
      workDir: ciWorkDir,
      diffSource: { kind: "git-range", base: git(repo, "merge-base", "main", featHeadSha), head: featHeadSha },
      writeOutputs: false,
    });
    expect(
      branchRes.manifest.files.map((f) => ({
        path: f.path,
        sha: f.sourceSha256,
        syms: f.symbols.map((s) => s.qualifiedName),
      })),
    ).toEqual(
      ciManifest.files.map((f) => ({ path: f.path, sha: f.sourceSha256, syms: f.symbols.map((s) => s.qualifiedName) })),
    );

    // Verify auto-detection of baseRef via origin/HEAD when .unit-agent.yml leaves local.baseRef unset
    const cfgNoBase = readFileSync(path.join(repo, ".unit-agent.yml"), "utf8").replace("  baseRef: main\n", "");
    writeFileSync(path.join(repo, ".unit-agent.yml"), cfgNoBase, "utf8");
    git(repo, "add", ".unit-agent.yml");
    git(repo, "commit", "-m", "drop local.baseRef");
    git(repo, "branch", "-D", "main");
    const autoBaseRes = await runLocalDetect({
      repoRoot: repo,
      workDir: path.join(repo, ".ua-autobase"),
      scope: "branch",
      skipBaseline: true,
    });
    expect(autoBaseRes.summary.baseRef).toBe("origin/main");
    expect(autoBaseRes.manifest.files.map((f) => f.path)).toEqual(["src/calc.js"]);

    // 2. Branch scope also includes uncommitted + untracked changes; staged only sees staged; worktree sees uncommitted + untracked
    writeFileSync(
      path.join(repo, "src", "stagedOnly.js"),
      "export function stagedFn(n) {\n  const out = n + 1;\n  return out;\n}\n",
      "utf8",
    );
    git(repo, "add", "src/stagedOnly.js");
    writeFileSync(
      path.join(repo, "src", "untrackedOnly.js"),
      "export function untrackedFn(n) {\n  const out = n * 2;\n  return out;\n}\n",
      "utf8",
    );

    const stagedRes = await runLocalDetect({
      repoRoot: repo,
      workDir: path.join(repo, ".ua-staged"),
      scope: "staged",
      skipBaseline: true,
    });
    expect(stagedRes.manifest.files.map((f) => f.path)).toEqual(["src/stagedOnly.js"]);

    const worktreeRes = await runLocalDetect({
      repoRoot: repo,
      workDir: path.join(repo, ".ua-worktree"),
      scope: "worktree",
      skipBaseline: true,
    });
    expect(worktreeRes.manifest.files.map((f) => f.path).sort()).toEqual(["src/stagedOnly.js", "src/untrackedOnly.js"]);

    const branchPlusUncommitted = await runLocalDetect({
      repoRoot: repo,
      workDir: path.join(repo, ".ua-branch-dirty"),
      scope: "branch",
      skipBaseline: true,
    });
    expect(branchPlusUncommitted.manifest.files.map((f) => f.path).sort()).toEqual([
      "src/calc.js",
      "src/stagedOnly.js",
      "src/untrackedOnly.js",
    ]);

    // 3. files scope with --symbols Class.* wildcard and --include-covered
    const wildcardRes = await runLocalDetect({
      repoRoot: repo,
      workDir: path.join(repo, ".ua-wild"),
      scope: "files",
      files: ["src/calc.js"],
      symbols: ["Calculator.*"],
      skipBaseline: true,
    });
    expect(wildcardRes.manifest.files[0]?.symbols.map((s) => s.qualifiedName)).toEqual([
      "Calculator.divide",
      "Calculator.square",
    ]);

    const covPath = path.join(repo, "coverage", "custom.lcov");
    mkdirSync(path.dirname(covPath), { recursive: true });
    writeFileSync(
      covPath,
      "SF:src/calc.js\nDA:1,1\nDA:2,1\nDA:3,1\nDA:7,1\nDA:8,1\nDA:9,1\nDA:11,1\nDA:12,1\nend_of_record\n",
      "utf8",
    );
    const coveredExcluded = await runLocalDetect({
      repoRoot: repo,
      workDir: path.join(repo, ".ua-cov-exc"),
      scope: "files",
      files: ["src/calc.js"],
      coverageFile: covPath,
    });
    expect(coveredExcluded.manifest.files).toEqual([]);

    const coveredIncluded = await runLocalDetect({
      repoRoot: repo,
      workDir: path.join(repo, ".ua-cov-inc"),
      scope: "files",
      files: ["src/calc.js"],
      symbols: ["add"],
      includeCovered: true,
      coverageFile: covPath,
    });
    expect(coveredIncluded.manifest.files[0]?.symbols.map((s) => s.qualifiedName)).toEqual(["add"]);
  });

  it("honors reuseCoverage mtime freshness, --skip-baseline, and --refresh-baseline", async () => {
    const repo = createFakeVitestRepo();
    const workDir = path.join(repo, ".unit-agent");
    const countFile = path.join(repo, ".baseline-runs");

    // 1. Fresh run invokes baseline script once
    const first = await runLocalDetect({
      repoRoot: repo,
      workDir,
      scope: "files",
      files: ["src/calc.js"],
    });
    expect(first.summary.baseline.reusedCoverage).toBe(false);
    expect(first.summary.baseline.status).toBe("green");
    expect(readFileSync(countFile, "utf8")).toBe("1");

    // 2. Make coverage file strictly newer than src/calc.js -> reuses cached coverage
    const covFile = path.join(repo, "coverage", "lcov.info");
    const future = new Date(Date.now() + 10_000);
    utimesSync(covFile, future, future);

    const second = await runLocalDetect({
      repoRoot: repo,
      workDir,
      scope: "files",
      files: ["src/calc.js"],
    });
    expect(second.summary.baseline.reusedCoverage).toBe(true);
    expect(readFileSync(countFile, "utf8")).toBe("1");

    // 3. Touch src/calc.js newer than coverage -> invalidates cache and re-runs baseline
    const evenNewer = new Date(Date.now() + 20_000);
    utimesSync(path.join(repo, "src", "calc.js"), evenNewer, evenNewer);

    const third = await runLocalDetect({
      repoRoot: repo,
      workDir,
      scope: "files",
      files: ["src/calc.js"],
    });
    expect(third.summary.baseline.reusedCoverage).toBe(false);
    expect(readFileSync(countFile, "utf8")).toBe("2");

    // 4. Refresh via CLI --refresh-baseline forces run even when coverage is newer
    const superNew = new Date(Date.now() + 30_000);
    utimesSync(covFile, superNew, superNew);
    await runCli([
      "node",
      "cli.js",
      "--repo-root",
      repo,
      "local",
      "detect",
      "--files",
      "src/calc.js",
      "--refresh-baseline",
    ]);
    expect(readFileSync(countFile, "utf8")).toBe("3");

    // 5. --skip-baseline does not run baseline script
    await runCli([
      "node",
      "cli.js",
      "--repo-root",
      repo,
      "local",
      "detect",
      "--files",
      "src/calc.js",
      "--skip-baseline",
    ]);
    expect(readFileSync(countFile, "utf8")).toBe("3");
  });

  it("supports local show --max-chars trim order and preserves target symbols", async () => {
    const repo = createFakeVitestRepo();
    const bigPad = "// pad comment line for trimming budget\n".repeat(120);
    writeFileSync(
      path.join(repo, "src", "calc.js"),
      `${bigPad}\nexport function add(a, b) {\n  const out = a + b;\n  return out;\n}\n`,
      "utf8",
    );
    git(repo, "add", "src/calc.js");
    git(repo, "commit", "-m", "pad calc");

    const workDir = path.join(repo, ".unit-agent");
    const detected = await runLocalDetect({
      repoRoot: repo,
      workDir,
      scope: "files",
      files: ["src/calc.js"],
      skipBaseline: true,
    });
    const fileId = detected.manifest.files[0]!.fileId;

    const fullPacket = runLocalShow({ workDir, fileId, maxChars: 100_000 });
    expect(fullPacket.targets.map((t) => t.qualifiedName)).toContain("add");

    const trimmed = runLocalShow({ workDir, fileId, maxChars: 1200 });
    expect(trimmed.styleSample).toBeUndefined();
    expect(trimmed.sourceFile.truncated).toBe(true);
    expect(trimmed.targets[0]?.qualifiedName).toBe("add");
    expect(JSON.stringify(trimmed, null, 2).length).toBeLessThanOrEqual(1600);
  });

  it("rejects unknown staged paths, reports draft_missing, cleans up placed.json leftovers, and validates + applies cleanly with --stage", async () => {
    const repo = createFakeVitestRepo();
    const workDir = path.join(repo, ".unit-agent");
    const initialCommitCount = Number.parseInt(git(repo, "rev-list", "--count", "HEAD"), 10);

    // Simulate interrupted run leaving a placed test file recorded in placed.json
    const placedRel = "test/unit/leaked-crash.test.js";
    writeFileSync(path.join(repo, placedRel), "// leftover from crashed run\n", "utf8");
    const placedRecordPath = path.join(workDir, "chat", "placed.json");
    recordPlacedFile(workDir, placedRel, true);

    const statusBefore = await runLocalStatus({ repoRoot: repo, workDir });
    expect(existsSync(path.join(repo, placedRel))).toBe(false);
    expect(existsSync(placedRecordPath)).toBe(false);
    expect(statusBefore.stage).toBe("none");

    const detected = await runLocalDetect({
      repoRoot: repo,
      workDir,
      scope: "files",
      files: ["src/calc.js"],
      skipBaseline: true,
    });
    const mf = detected.manifest.files[0]!;
    const stagingAbs = path.join(repo, ".unit-agent", "chat", "proposed");

    // 1. Validate with missing expected draft + rogue unknown staged file
    mkdirSync(path.join(stagingAbs, "test", "unit"), { recursive: true });
    writeFileSync(
      path.join(stagingAbs, "test", "unit", "rogue.test.js"),
      "import { it, expect } from 'vitest';\nit('r', () => expect(1).toBe(1));\n",
      "utf8",
    );
    const invalidSummary = await runLocalValidate({ repoRoot: repo, workDir, attempt: 1 });
    expect(invalidSummary.files.find((f) => f.testPath === "test/unit/rogue.test.js")?.reason).toBe("path_violation");
    expect(invalidSummary.files.find((f) => f.fileId === mf.fileId)?.reason).toBe("draft_missing");

    // 2. Replace with valid staged draft for calc.test.js (coverage gains DA:1..3 & 6..8)
    rmSync(path.join(stagingAbs, "test", "unit", "rogue.test.js"), { force: true });
    writeFileSync(
      path.join(stagingAbs, mf.testPath),
      `import { describe, it, expect } from "vitest";
import { add, mul } from "../../src/calc.js";

describe("calc", () => {
  it("adds numbers", () => {
    expect(add(2, 3)).toBe(5);
  });

  it("multiplies numbers", () => {
    expect(mul(3, 4)).toBe(12);
  });
});
`,
      "utf8",
    );

    const valSummary = await runLocalValidate({ repoRoot: repo, workDir, attempt: 1 });
    expect(valSummary.environmentError).toBeNull();
    expect(valSummary.files[0]?.outcome).toBe("accepted");
    expect(valSummary.files[0]?.gainedLines ?? 0).toBeGreaterThan(0);

    // 3. Dry run apply does not write to repo
    const dryRes = await runLocalApply({ repoRoot: repo, workDir, confirm: false });
    expect(dryRes.exitCode).toBe(EXIT_CODES.OK);
    expect(dryRes.summary.dryRun).toBe(true);
    expect(dryRes.summary.written).toHaveLength(1);
    expect(existsSync(path.join(repo, mf.testPath))).toBe(false);

    // 4. Tamper validated artifact SHA-256 -> exits 60 with hash_mismatch
    const finalValidatedPath = path.join(workDir, ARTIFACTS.final.dir, "validated", mf.testPath);
    const snapValidatedPath = path.join(workDir, ARTIFACTS.snapshot1.dir, "validated", mf.testPath);
    const valValidatedPath = existsSync(finalValidatedPath) ? finalValidatedPath : snapValidatedPath;
    const savedValidated = readFileSync(valValidatedPath, "utf8");
    writeFileSync(valValidatedPath, `${savedValidated}// tampered\n`, "utf8");
    const tamperRes = await runLocalApply({ repoRoot: repo, workDir, confirm: true });
    expect(tamperRes.exitCode).toBe(EXIT_CODES.POLICY_OR_HASH);
    expect(tamperRes.summary.refused[0]?.reason).toBe("hash_mismatch");
    writeFileSync(valValidatedPath, savedValidated, "utf8");

    // 5. Modify source file after detect -> exits 50 with source_changed
    const origSource = readFileSync(path.join(repo, "src", "calc.js"), "utf8");
    writeFileSync(path.join(repo, "src", "calc.js"), `${origSource}\n// edited after detect\n`, "utf8");
    const staleRes = await runLocalApply({ repoRoot: repo, workDir, confirm: true });
    expect(staleRes.exitCode).toBe(EXIT_CODES.STALE_HEAD_OR_SOURCE);
    expect(staleRes.summary.refused[0]?.reason).toBe("source_changed");
    writeFileSync(path.join(repo, "src", "calc.js"), origSource, "utf8");

    // 6. Real apply with --stage -> writes file, cleans staging, runs git add, zero new commits
    const applyRes = await runLocalApply({ repoRoot: repo, workDir, confirm: true, stage: true });
    expect(applyRes.exitCode).toBe(EXIT_CODES.OK);
    expect(applyRes.summary.written).toHaveLength(1);
    expect(applyRes.summary.staged).toBe(true);
    expect(existsSync(path.join(repo, mf.testPath))).toBe(true);
    expect(existsSync(path.join(stagingAbs, mf.testPath))).toBe(false);
    expect(git(repo, "status", "--porcelain")).toContain(`A  ${mf.testPath}`);
    expect(Number.parseInt(git(repo, "rev-list", "--count", "HEAD"), 10)).toBe(initialCommitCount);

    // 7. Re-running apply when target already exists refuses with target_exists
    const existsRes = await runLocalApply({ repoRoot: repo, workDir, confirm: true });
    expect(existsRes.summary.refused[0]?.reason).toBe("target_exists");
  });

  it("enforces <= 8192 byte bounded JSON summaries with normalized forward slashes", () => {
    const huge = {
      schemaVersion: 1 as const,
      scope: "branch" as const,
      baseRef: "main",
      baseline: { status: "green" as const, reusedCoverage: false },
      files: Array.from({ length: 45 }, (_, idx) => ({
        fileId: `f-${idx}`,
        path: `src\\nested\\mod_${idx}.ts`,
        testPath: `test\\unit\\mod_${idx}.test.ts`,
        stagedPath: `.unit-agent\\chat\\proposed\\test\\unit\\mod_${idx}.test.ts`,
        contextPath: `.unit-agent\\prepare\\contexts\\f-${idx}.json`,
        symbols: Array.from({ length: 20 }, (__, sIdx) => ({
          symbolId: `s-${idx}-${sIdx}`,
          qualifiedName: `Class_${idx}.method_${sIdx}`,
          coveragePct: 0,
          changedLines: 5,
        })),
      })),
      skipped: Array.from({ length: 20 }, (_, i) => ({ path: `src\\skip\\file_${i}.ts`, reason: "already_covered" })),
      next: "Run local show",
      truncated: false,
    };

    const normalized = normalizeSummaryPaths(huge);
    const serialized = serializeBoundedSummary(normalized);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(MAX_LOCAL_SUMMARY_BYTES);
    expect(serialized).not.toContain("\\\\");
    const parsed = LocalDetectSummarySchema.parse(JSON.parse(serialized));
    expect(parsed.truncated).toBe(true);
  });

  it("installs chat files via init-chat, preserves customized files without --force, handles JSONC & invalid tasks.json fallback, and makes zero network calls", async () => {
    const repo = createFakeVitestRepo();
    const workDir = path.join(repo, ".unit-agent");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("Network call forbidden during local commands");
    });

    // Write existing JSONC .vscode/tasks.json with comments, trailing comma, and custom task
    mkdirSync(path.join(repo, ".vscode"), { recursive: true });
    writeFileSync(
      path.join(repo, ".vscode", "tasks.json"),
      `{
  // Existing workspace task comment
  "version": "2.0.0",
  "tasks": [
    {
      "label": "custom: build",
      "type": "shell",
      "command": "npm run build",
    },
  ],
}
`,
      "utf8",
    );

    const init1 = await runInitChat({ repoRoot: repo, workDir, withTasks: true });
    expect(init1.doctor.ok).toBe(true);
    const agentPath = path.join(repo, ".github", "agents", "unit-agent.agent.md");
    const agentBody = readFileSync(agentPath, "utf8");
    expect(agentBody).toContain(extractTestRulesBlock().replaceAll("{{maxTestsPerSymbol}}", "6"));
    expect(agentBody).toMatch(/^---\r?\nname: unit-agent\r?\ndescription: '/);
    expect(agentBody).not.toContain("\nmodel:");

    const tasksMerged = JSON.parse(readFileSync(path.join(repo, ".vscode", "tasks.json"), "utf8")) as {
      tasks: Array<{ label: string }>;
    };
    expect(tasksMerged.tasks.some((t) => t.label === "custom: build")).toBe(true);
    expect(tasksMerged.tasks.some((t) => t.label.startsWith("unit-agent:"))).toBe(true);

    // Custom edit preserved without --force
    writeFileSync(agentPath, `${agentBody}\n<!-- custom user note -->\n`, "utf8");
    const init2 = await runInitChat({ repoRoot: repo, workDir, force: false, withTasks: false });
    expect(init2.files.find((f) => f.path === ".github/agents/unit-agent.agent.md")?.action).toBe("skipped_modified");
    expect(readFileSync(agentPath, "utf8")).toContain("custom user note");

    // Broken .vscode/tasks.json triggers sample fallback without overwriting broken file
    writeFileSync(path.join(repo, ".vscode", "tasks.json"), "{ invalid json here", "utf8");
    const init3 = await runInitChat({ repoRoot: repo, workDir, force: true, withTasks: true });
    expect(init3.files.find((f) => f.path === ".github/agents/unit-agent.agent.md")?.action).toBe("updated");
    expect(readFileSync(agentPath, "utf8")).not.toContain("custom user note");
    expect(init3.tasksSampleWritten).toBe(true);
    expect(existsSync(path.join(repo, ".vscode", "unit-agent.tasks.sample.json"))).toBe(true);
    expect(readFileSync(path.join(repo, ".vscode", "tasks.json"), "utf8")).toBe("{ invalid json here");

    // Verify local detect/show/validate/status/apply also trigger zero fetch calls
    await runLocalDetect({ repoRoot: repo, workDir, scope: "files", files: ["src/calc.js"], skipBaseline: true });
    const manifest = LocalDetectSummarySchema.parse(
      JSON.parse(
        serializeBoundedSummary(
          normalizeSummaryPaths(
            (
              await runLocalDetect({
                repoRoot: repo,
                workDir,
                scope: "files",
                files: ["src/calc.js"],
                skipBaseline: true,
              })
            ).summary,
          ),
        ),
      ),
    );
    const packet = FileContextSchema.parse(runLocalShow({ workDir, fileId: manifest.files[0]!.fileId }));
    expect(packet.sourceFile.path).toBe("src/calc.js");
    LocalValidateSummarySchema.parse(await runLocalValidate({ repoRoot: repo, workDir }));
    await runLocalStatus({ repoRoot: repo, workDir });
    await runLocalApply({ repoRoot: repo, workDir, confirm: false });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports passing and failing doctor diagnostics (Node < 20, missing binary, broken preflight, stale chat files)", async () => {
    const repo = createFakeVitestRepo();
    const workDir = path.join(repo, ".unit-agent");
    await runInitChat({ repoRoot: repo, workDir, withTasks: false });

    // Healthy baseline repo passes doctor
    const healthy = await runLocalDoctor({ repoRoot: repo, workDir, full: false });
    expect(healthy.ok).toBe(true);
    expect(healthy.checks.find((c) => c.name === "chat-files")?.status).toBe("pass");

    // Node < 20 fails
    const oldNode = await runLocalDoctor({ repoRoot: repo, workDir, light: true, nodeVersionOverride: "18.19.0" });
    expect(oldNode.ok).toBe(false);
    expect(oldNode.checks.find((c) => c.name === "runtime-and-git")?.status).toBe("fail");

    // Stale chat file version warns
    const agentPath = path.join(repo, ".github", "agents", "unit-agent.agent.md");
    writeFileSync(agentPath, readFileSync(agentPath, "utf8").replace("init-chat 2.0.0", "init-chat 1.0.0"), "utf8");
    const staleChat = await runLocalDoctor({ repoRoot: repo, workDir, light: true });
    expect(staleChat.checks.find((c) => c.name === "chat-files")?.status).toBe("warn");

    // Missing binary fails preflight
    const brokenCfg = readFileSync(path.join(repo, ".unit-agent.yml"), "utf8").replace(
      'testCommand: "node scripts/fake-vitest.mjs"',
      'testCommand: "definitely-missing-runner-binary-xyz"',
    );
    writeFileSync(path.join(repo, ".unit-agent.yml"), brokenCfg, "utf8");
    const missingBin = await runLocalDoctor({ repoRoot: repo, workDir });
    expect(missingBin.ok).toBe(false);
    expect(missingBin.checks.find((c) => c.name === "preflight:javascript")?.status).toBe("fail");

    // Restoring binary + simulating failing runner under --full fails coverage/preflight
    writeFileSync(
      path.join(repo, ".unit-agent.yml"),
      brokenCfg.replace(
        'testCommand: "definitely-missing-runner-binary-xyz"',
        'testCommand: "node scripts/fake-vitest.mjs"',
      ),
      "utf8",
    );
    writeFileSync(path.join(repo, ".fail-tests"), "1", "utf8");
    const brokenRun = await runLocalDoctor({ repoRoot: repo, workDir, full: true });
    expect(brokenRun.ok).toBe(false);
    expect(
      brokenRun.checks.some((c) => (c.name === "coverage" || c.name === "preflight:javascript") && c.status === "fail"),
    ).toBe(true);
    expect(sha256Hex("ok")).toHaveLength(64);
  });

  it("preserves comma-brace inside JSONC strings in init-chat and enforces maxChars with heavy JSON escaping in local show", async () => {
    const repo = createFakeVitestRepo();
    const workDir = path.join(repo, ".unit-agent");
    mkdirSync(path.join(repo, ".vscode"), { recursive: true });
    writeFileSync(
      path.join(repo, ".vscode", "tasks.json"),
      '{\n  "version": "2.0.0",\n  "tasks": [\n    { "label": "custom: keep", "command": "echo , }" },\n  ],\n}\n',
      "utf8",
    );
    await runInitChat({ repoRoot: repo, workDir, withTasks: true });
    const mergedTasks = JSON.parse(readFileSync(path.join(repo, ".vscode", "tasks.json"), "utf8")) as {
      tasks: Array<{ label: string; command?: string; args?: string[] }>;
    };
    const customTask = mergedTasks.tasks.find((t) => t.label === "custom: keep");
    expect(customTask?.command).toBe("echo , }");
    const uaTask = mergedTasks.tasks.find((t) => t.label === "unit-agent: status");
    expect(Array.isArray(uaTask?.args)).toBe(true);

    const detectRes = await runLocalDetect({
      repoRoot: repo,
      workDir,
      scope: "files",
      files: ["src/calc.js"],
      skipBaseline: true,
    });
    const fileId = detectRes.summary.files[0]!.fileId;
    const ctxPath = path.join(workDir, "prepare", "contexts", `${fileId}.json`);
    const rawCtx = JSON.parse(readFileSync(ctxPath, "utf8")) as { sourceFile: { content: string } };
    rawCtx.sourceFile.content = '"quote"\n'.repeat(200);
    writeFileSync(ctxPath, JSON.stringify(rawCtx, null, 2), "utf8");

    const trimmed = runLocalShow({ workDir, fileId, maxChars: 900 });
    expect(JSON.stringify(trimmed, null, 2).length).toBeLessThanOrEqual(900);
    expect(trimmed.sourceFile.truncated).toBe(true);
  });
});
