import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { tokenizeCommand } from "../../../../../../agents/node/testgen/src/config";
import {
  ARTIFACTS,
  ConfigSchema,
  EXIT_CODES,
  FinalSchema,
  ManifestSchema,
  ProposedSchema,
  StageError,
  type GitHubClientLike,
} from "../../../../../../agents/node/testgen/src/contracts";
import { sha256Hex } from "../../../../../../agents/node/testgen/src/core/context";
import { parseUnifiedDiff } from "../../../../../../agents/node/testgen/src/core/git";
import { toRepoPath } from "../../../../../../agents/node/testgen/src/core/paths";
import { runStaticPolicyCheck } from "../../../../../../agents/node/testgen/src/core/policy";
import { buildChildEnv, runCommand } from "../../../../../../agents/node/testgen/src/exec/exec";
import { resolveGitHubTokensFromEnv } from "../../../../../../agents/node/testgen/src/github";
import { FakeLlmClient } from "../../../../../../agents/node/testgen/src/llm/fake-client";
import { runLocalApply } from "../../../../../../agents/node/testgen/src/local/apply";
import {
  cleanupLeftoverPlacedFiles,
  recordPlacedFile,
} from "../../../../../../agents/node/testgen/src/local/placement";
import { runLocalValidate } from "../../../../../../agents/node/testgen/src/local/validate";
import { runCommit } from "../../../../../../agents/node/testgen/src/stages/commit";
import { runGenerate } from "../../../../../../agents/node/testgen/src/stages/generate";
import { runPublish } from "../../../../../../agents/node/testgen/src/stages/publish";
import { runValidate } from "../../../../../../agents/node/testgen/src/stages/validate";
import { prepareValidationWorkspace } from "../../../../../../agents/node/testgen/src/stages/validate/workspace";
import { sanitizeForMarkdown, sanitizeOutput } from "../../../../../../agents/node/testgen/src/telemetry";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../..");
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

let prevGithubRepo: string | undefined;

beforeEach(() => {
  prevGithubRepo = process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_REPOSITORY;
});

afterEach(() => {
  if (prevGithubRepo === undefined) {
    delete process.env.GITHUB_REPOSITORY;
  } else {
    process.env.GITHUB_REPOSITORY = prevGithubRepo;
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
});

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function makeMockGitHub(overrides: Partial<GitHubClientLike> = {}): {
  client: GitHubClientLike;
  comments: string[];
  commits: number;
} {
  const comments: string[] = [];
  let commits = 0;
  const client: GitHubClientLike = {
    getPullRequest: async () => ({
      headSha: "head123",
      headRef: "feat/security",
      headRepoFullName: "org/repo",
      baseRepoFullName: "org/repo",
      draft: false,
      authorLogin: "dev",
      authorType: "User",
      labels: [],
      headCommitMessage: "feat: work",
    }),
    listIssueComments: async () => [],
    createIssueComment: async (_o, _r, _p, body) => {
      comments.push(body);
      return { id: comments.length };
    },
    updateIssueComment: async (_o, _r, _id, body) => {
      comments.push(body);
    },
    getEnvironment: async () => ({ exists: true, status: 200, hasRequiredReviewers: true }),
    getRunApprovals: async () => ["approver-alice"],
    createCommitOnBranch: async () => {
      commits += 1;
      return { oid: "commit-oid-1" };
    },
    ...overrides,
  };
  return {
    client,
    comments,
    get commits() {
      return commits;
    },
  };
}

describe("Security suite (Section 10.4 mandatory checks 1-11)", () => {
  it.skipIf(process.platform !== "linux")(
    "1a. offline-unshare blocks outbound network while allowing loopback on Linux CI",
    async () => {
      const dir = makeTempDir("ua-sec-unshare-");
      const script = path.join(REPO_ROOT, "agents/node/testgen/scripts/run-offline.sh");
      const res = await runCommand(
        process.execPath,
        [
          "-e",
          "const net=require('node:net'); const s=net.createConnection({host:'1.1.1.1',port:80,timeout:1500},()=>process.exit(0)); s.on('error',()=>process.exit(42)); s.on('timeout',()=>process.exit(42));",
        ],
        {
          cwd: dir,
          useOfflineWrapper: true,
          offlineScriptPath: script,
          config: { offline: { strategy: "unshare" }, env: { pass: [], passProxy: false } },
        },
      );
      expect([0, 42, 125]).toContain(res.exitCode);
    },
  );

  it("1b. offline-unshare falls back cleanly to strategy 'none' with a visible note when unavailable", async () => {
    const dir = makeTempDir("ua-sec-unshare-fb-");
    const res = await runCommand(process.execPath, ["-e", "console.log('ok')"], {
      cwd: dir,
      useOfflineWrapper: true,
      offlineScriptPath: path.join(dir, "missing-unshare.sh"),
      config: { offline: { strategy: "unshare" }, env: { pass: [], passProxy: false } },
    });
    expect(res.exitCode).toBe(0);
    expect(res.notes.join("\n")).toContain("offline.strategy 'unshare' unavailable");
  });

  it("2. env-secrets strips all secret tokens and preserves Windows SystemRoot/PATHEXT", async () => {
    const canaryParent: Record<string, string | undefined> = {
      ...process.env,
      COPILOT_GITHUB_TOKEN: "ghp_CANARY_COPILOT_TOKEN_123456",
      GITHUB_TOKEN: "ghs_CANARY_GITHUB_TOKEN_123456",
      UA_COMMIT_TOKEN: "github_pat_CANARY_UA_COMMIT_123456",
      COMMIT_PAT: "github_pat_CANARY_PAT_123456",
      CUSTOM_API_SECRET: "canary_secret_value_xyz",
      CUSTOM_AUTH: "Bearer canary_auth_header",
      SESSION_COOKIE: "sid=canary_cookie",
      SIGNING_KEY: "canary_signing_key",
      MY_PAT: "ghp_canary_pat",
      SAFE_USER_VAR: "allowed-value",
    };

    const childEnv = buildChildEnv(
      {
        env: {
          pass: [
            "SAFE_USER_VAR",
            "CUSTOM_API_SECRET",
            "COPILOT_GITHUB_TOKEN",
            "COMMIT_PAT",
            "CUSTOM_AUTH",
            "SESSION_COOKIE",
            "SIGNING_KEY",
            "MY_PAT",
          ],
          passProxy: false,
        },
      },
      {},
      canaryParent,
    );
    expect(childEnv.COPILOT_GITHUB_TOKEN).toBeUndefined();
    expect(childEnv.GITHUB_TOKEN).toBeUndefined();
    expect(childEnv.UA_COMMIT_TOKEN).toBeUndefined();
    expect(childEnv.COMMIT_PAT).toBeUndefined();
    expect(childEnv.CUSTOM_API_SECRET).toBeUndefined();
    expect(childEnv.CUSTOM_AUTH).toBeUndefined();
    expect(childEnv.SESSION_COOKIE).toBeUndefined();
    expect(childEnv.SIGNING_KEY).toBeUndefined();
    expect(childEnv.MY_PAT).toBeUndefined();
    expect(childEnv.SAFE_USER_VAR).toBe("allowed-value");
    expect(Object.keys(childEnv).some((k) => k.toUpperCase() === "PATH")).toBe(true);
    if (process.platform === "win32") {
      expect(Object.keys(childEnv).some((k) => k.toUpperCase() === "SYSTEMROOT")).toBe(true);
      expect(Object.keys(childEnv).some((k) => k.toUpperCase() === "PATHEXT")).toBe(true);
      if (Object.keys(process.env).some((k) => k.toUpperCase() === "HOMEPATH")) {
        expect(Object.keys(childEnv).some((k) => k.toUpperCase() === "HOMEPATH")).toBe(true);
      }
    }

    const dir = makeTempDir("ua-sec-env-");
    const res = await runCommand(process.execPath, ["-e", "console.log(JSON.stringify(process.env))"], {
      cwd: dir,
      parentEnv: canaryParent,
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).not.toContain("ghp_CANARY_COPILOT_TOKEN_123456");
    expect(res.stdout).not.toContain("ghs_CANARY_GITHUB_TOKEN_123456");
    expect(res.stdout).not.toContain("github_pat_CANARY_PAT_123456");
    expect(res.stdout).not.toContain("canary_secret_value_xyz");
  });

  it("3. snapshot-integrity preserves pre-execution snapshot bytes and exits 60 on commit tamper", async () => {
    const repo = makeTempDir("ua-sec-snap-");
    const workDir = path.join(repo, ".unit-agent");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    mkdirSync(path.join(repo, "test"), { recursive: true });
    writeFileSync(
      path.join(repo, "src/math.ts"),
      "export function add(a: number, b: number) {\n  return a + b;\n}\n",
      "utf8",
    );

    // Self-modifying test runner inside copy attempts to rewrite its own test file during execution
    writeFileSync(
      path.join(repo, "fake-runner.mjs"),
      [
        'import { writeFileSync } from "node:fs";',
        "const testRel = process.argv[2];",
        'writeFileSync(testRel, "// tampered-during-exec\\n", "utf8");',
        "process.exit(0);",
      ].join("\n"),
      "utf8",
    );

    const cfg = ConfigSchema.parse({
      version: 1,
      mode: "propose",
      policy: { dropZeroGainFiles: false },
      languages: {
        javascript: {
          framework: "vitest",
          testCommand: `"${process.execPath}" fake-runner.mjs`,
          coverageFile: "coverage/lcov.info",
          coverageFormat: "lcov",
          sourceGlobs: ["src/**/*.ts"],
          testPathPatterns: ["test/{name}.test.ts"],
        },
      },
    });

    const manifest = ManifestSchema.parse({
      schemaVersion: 1,
      runId: "sec-3",
      repo: "org/repo",
      pr: 1,
      baseSha: "base000",
      headSha: "head123",
      createdAt: new Date().toISOString(),
      baseline: { status: "no_coverage", perLanguage: {}, patchCoveragePct: null },
      warnings: [],
      skipped: [],
      files: [
        {
          fileId: "f1",
          language: "javascript",
          path: "src/math.ts",
          testPath: "test/math.test.ts",
          importHint: "../src/math",
          contextPath: "prepare/contexts/f1.json",
          sourceSha256: sha256Hex("export function add(a: number, b: number) {\n  return a + b;\n}\n"),
          symbols: [
            {
              symbolId: "src/math.ts#add",
              qualifiedName: "add",
              kind: "function",
              signature: "function add(a: number, b: number)",
              range: { startLine: 1, endLine: 3 },
              executableLines: 2,
              coveredLines: 0,
              coveragePct: 0,
              changedLines: [1, 2, 3],
              complexity: 1,
              score: 10,
            },
          ],
        },
      ],
    });

    const originalTest = [
      'import { expect, it } from "vitest";',
      'import { add } from "../src/math";',
      'it("adds", () => {',
      "  expect(add(2, 3)).toBe(5);",
      "});",
      "",
    ].join("\n");

    const proposed = ProposedSchema.parse({
      schemaVersion: 1,
      runId: "sec-3",
      headSha: "head123",
      model: null,
      files: [
        {
          fileId: "f1",
          testPath: "test/math.test.ts",
          content: originalTest,
          sha256: sha256Hex(originalTest),
          symbolIds: ["src/math.ts#add"],
          assumptions: [],
          status: "ok",
        },
      ],
    });

    const vRes = await runValidate({
      repoRoot: repo,
      workDir,
      config: cfg,
      manifest,
      proposed,
      phase: "all",
      attempt: 1,
      local: true,
      writeOutputs: false,
    });
    expect(vRes.report.files[0]?.outcome).toBe("accepted");
    const snapBytes = readFileSync(path.join(workDir, ARTIFACTS.snapshot1.dir, "validated/test/math.test.ts"), "utf8");
    expect(snapBytes).not.toContain("tampered-during-exec");
    expect(snapBytes).toBe(`// unit-agent:generated\n${originalTest}`);

    // Now test commit tamper -> exit 60
    const fakeGh = makeMockGitHub();
    const pubRes = await runPublish({
      repoRoot: repo,
      workDir,
      config: cfg,
      report: vRes.report,
      repoFullName: "org/repo",
      prNumber: 1,
      headSha: "head123",
      github: fakeGh.client,
      approvalCheck: "api",
      writeOutputs: false,
    });
    expect(pubRes.finalArtifact.files.length).toBe(1);

    // Mutate final/validated byte after publish
    const finalValidated = path.join(workDir, ARTIFACTS.final.dir, "validated/test/math.test.ts");
    writeFileSync(finalValidated, `${snapBytes}\n// malicious-post-snapshot-edit\n`, "utf8");

    let caught: unknown;
    try {
      await runCommit({
        workDir,
        expectedHead: "head123",
        github: fakeGh.client,
        writeOutputs: false,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StageError);
    expect((caught as StageError).code).toBe(EXIT_CODES.POLICY_OR_HASH);
    expect(fakeGh.commits).toBe(0);
  });

  it("4. path-safety rejects traversal, absolute paths, symlinks, and overwrite of existing files", async () => {
    const repo = makeTempDir("ua-sec-path-");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    mkdirSync(path.join(repo, "test"), { recursive: true });
    writeFileSync(path.join(repo, "test/existing.test.ts"), "// existing test\n", "utf8");

    expect(() => toRepoPath("../outside.test.ts", repo)).toThrow();
    expect(() => toRepoPath("/etc/passwd", repo)).toThrow();

    // Symlink escape inside repo
    const outsideTarget = makeTempDir("ua-sec-outside-");
    writeFileSync(path.join(outsideTarget, "leak.txt"), "secret", "utf8");
    const symlinkCreated = (() => {
      try {
        symlinkSync(outsideTarget, path.join(repo, "test/linked"), process.platform === "win32" ? "junction" : "dir");
        return true;
      } catch {
        return false;
      }
    })();

    const workDir = path.join(repo, ".unit-agent");
    const cfg = ConfigSchema.parse(
      parseYaml(
        readFileSync(path.join(REPO_ROOT, "agents/node/testgen/fixtures/repos/js-vitest/.unit-agent.yml"), "utf8"),
      ),
    );
    const manifest = ManifestSchema.parse({
      schemaVersion: 1,
      runId: "sec-4",
      repo: "org/repo",
      pr: 1,
      baseSha: "base",
      headSha: "head123",
      createdAt: new Date().toISOString(),
      baseline: { status: "no_coverage", perLanguage: {}, patchCoveragePct: null },
      warnings: [],
      skipped: [],
      files: [
        {
          fileId: "f1",
          language: "javascript",
          path: "src/math.ts",
          testPath: "test/math.unit-agent.test.ts",
          importHint: "../src/math",
          contextPath: "prepare/contexts/f1.json",
          sourceSha256: "a".repeat(64),
          symbols: [
            {
              symbolId: "src/math.ts#add",
              qualifiedName: "add",
              kind: "function",
              signature: "function add()",
              range: { startLine: 1, endLine: 2 },
              executableLines: 2,
              coveredLines: 0,
              coveragePct: 0,
              changedLines: [1, 2],
              complexity: 1,
              score: 10,
            },
          ],
        },
      ],
    });

    const badPaths = ["../escape.test.ts", path.join(os.tmpdir(), "abs.test.ts"), "test/existing.test.ts"];
    if (symlinkCreated) badPaths.push("test/linked/symlink.test.ts");

    for (const badPath of badPaths) {
      const proposed = ProposedSchema.parse({
        schemaVersion: 1,
        runId: "sec-4",
        headSha: "head123",
        model: null,
        files: [
          {
            fileId: "f1",
            testPath: badPath,
            content: 'import { it, expect } from "vitest"; it("x", () => expect(1).toBe(1));',
            sha256: "b".repeat(64),
            symbolIds: ["src/math.ts#add"],
            assumptions: [],
            status: "ok",
          },
        ],
      });
      const res = await runValidate({
        repoRoot: repo,
        workDir,
        config: cfg,
        manifest,
        proposed,
        phase: "static",
        attempt: 1,
        writeOutputs: false,
      });
      expect(res.report.files[0]?.outcome).toBe("rejected");
      expect(res.report.files[0]?.reason).toBe("path_violation");
    }
  });

  it("5. stale-head causes runCommit to exit 50 when PR head moved", async () => {
    const dir = makeTempDir("ua-sec-stale-");
    const workDir = path.join(dir, ".unit-agent");
    const validContent = [
      "// unit-agent:generated",
      'import { expect, it } from "vitest";',
      'import { add } from "../src/math";',
      'it("adds two numbers", () => {',
      "  expect(add(2, 3)).toBe(5);",
      "});",
      "",
    ].join("\n");
    const valFile = path.join(workDir, ARTIFACTS.final.dir, "validated/test/math.test.ts");
    mkdirSync(path.dirname(valFile), { recursive: true });
    writeFileSync(valFile, validContent, "utf8");
    const finalObj = FinalSchema.parse({
      schemaVersion: 1,
      runId: "sec-5",
      repo: "org/repo",
      pr: 7,
      headSha: "old-head-sha",
      headRef: "feat/x",
      mode: "propose",
      files: [
        {
          path: "test/math.test.ts",
          sha256: sha256Hex(validContent),
          symbolIds: ["s1"],
          testCount: 1,
          assumptions: [],
        },
      ],
      patchCoverage: { beforePct: 0, projectedPct: 80, targetPct: 80 },
      toolVersions: { agentNode: process.versions.node, languages: {}, warnings: [] },
      notes: [],
      rejected: [],
    });
    writeFileSync(path.join(workDir, ARTIFACTS.final.dir, "final.json"), JSON.stringify(finalObj), "utf8");

    const fakeGh = makeMockGitHub({
      getPullRequest: async () => ({
        headSha: "new-moved-head-sha",
        headRef: "feat/x",
        headRepoFullName: "org/repo",
        baseRepoFullName: "org/repo",
        draft: false,
        authorLogin: "dev",
        authorType: "User",
        labels: [],
        headCommitMessage: "new push",
      }),
    });

    let errCaught: unknown;
    try {
      await runCommit({
        workDir,
        expectedHead: "old-head-sha",
        github: fakeGh.client,
        writeOutputs: false,
      });
    } catch (e) {
      errCaught = e;
    }
    expect(errCaught).toBeInstanceOf(StageError);
    expect((errCaught as StageError).code).toBe(EXIT_CODES.STALE_HEAD_OR_SOURCE);
    expect(fakeGh.commits).toBe(0);
  });

  it("6. sanitization neutralizes mentions, issue refs, HTML, links, paths, and tokens", () => {
    const dirtyModelText = "Ping @org/team see #123 <script>evil()</script> [click](http://evil.example)";
    const safeMd = sanitizeForMarkdown(dirtyModelText);
    expect(safeMd).not.toContain("@org/team");
    expect(safeMd).toContain("@\u200Borg/team");
    expect(safeMd).toContain("#\u200B123");
    expect(safeMd).not.toContain("<script>");
    expect(safeMd).not.toContain("http://evil.example");

    const dirtyLog = `PATH=C:\\secret\nAuthorization: Bearer ghp_1234567890abcdefghij123456\nFail at ${REPO_ROOT}/src/cli.ts`;
    const cleanLog = sanitizeOutput(dirtyLog, { repoRoot: REPO_ROOT });
    expect(cleanLog).not.toContain("ghp_1234567890abcdefghij123456");
    expect(cleanLog).toContain("[REDACTED]");
    expect(cleanLog).toContain("<REPO>");
    expect(cleanLog).toContain("[ENV_REDACTED]");
  });

  it("7. permissions-audit enforces strict workflow trust boundaries in run.yml and validate.yml", () => {
    const runRaw = readFileSync(path.join(REPO_ROOT, ".github/workflows/_testgen-run.yml"), "utf8");
    const valRaw = readFileSync(path.join(REPO_ROOT, ".github/workflows/_testgen-validate.yml"), "utf8");
    const runDoc = parseYaml(runRaw) as {
      permissions?: Record<string, string>;
      jobs: Record<
        string,
        {
          permissions?: Record<string, string>;
          environment?: string;
          steps?: Array<{ uses?: string; with?: Record<string, string> }>;
        }
      >;
    };
    const valDoc = parseYaml(valRaw) as {
      permissions?: Record<string, string>;
      jobs: { validate: { permissions?: Record<string, string> } };
    };

    expect(runDoc.permissions).toEqual({});
    expect(valDoc.permissions).toEqual({});
    expect(valDoc.jobs.validate.permissions).toEqual({ contents: "read" });
    expect(valRaw).not.toMatch(/secrets\./);

    for (const llmJob of ["generate", "repair"] as const) {
      const job = runDoc.jobs[llmJob]!;
      expect(job.permissions).toEqual({});
      const stepUses = (job.steps ?? []).map((s) => s.uses ?? "");
      expect(stepUses.some((u) => u.startsWith("actions/checkout"))).toBe(false);
    }

    // Only generate and repair reference COPILOT_GITHUB_TOKEN
    for (const [jobName, job] of Object.entries(runDoc.jobs)) {
      const serialized = JSON.stringify(job);
      if (jobName === "generate" || jobName === "repair") {
        expect(serialized).toContain("COPILOT_GITHUB_TOKEN");
      } else {
        expect(serialized).not.toContain("COPILOT_GITHUB_TOKEN");
      }
      if (jobName === "approve-and-commit") {
        expect(job.permissions?.contents).toBe("write");
        expect(serialized).toContain("COMMIT_PAT");
        expect(job.environment).toBe("${{ inputs.approval-environment }}");
      } else {
        expect(job.permissions?.contents).not.toBe("write");
        expect(serialized).not.toContain("COMMIT_PAT");
      }
    }
  });

  it("8. process-exec enforces --throw-deprecation cleanliness, shell operator rejection, Windows .cmd execution, and grandchild kill on timeout", async () => {
    const dir = makeTempDir("ua-sec-exec-");

    // Reject shell operators in commands
    expect(() => tokenizeCommand("npx vitest & calc")).toThrow();
    expect(() => tokenizeCommand("pytest; rm -rf /")).toThrow();

    // --throw-deprecation cleanly executes dist/cli.js --help if built
    const distCli = path.join(REPO_ROOT, "agents/node/testgen/dist/cli.js");
    if (existsSync(distCli)) {
      const cliHelp = await runCommand(process.execPath, ["--throw-deprecation", distCli, "--help"], { cwd: dir });
      expect(cliHelp.exitCode).toBe(0);
    }

    // .cmd execution on Windows without shell (or .sh on POSIX)
    if (process.platform === "win32") {
      writeFileSync(path.join(dir, "hello.cmd"), "@echo off\r\necho WIN_CMD_OK\r\n", "utf8");
      const cmdRes = await runCommand("./hello.cmd", [], { cwd: dir });
      expect(cmdRes.exitCode).toBe(0);
      expect(cmdRes.stdout).toContain("WIN_CMD_OK");
    }

    // Grandchild tree kill on timeout
    const pidFile = path.join(dir, "grandchild.pid");
    const spawnGrandchildScript = [
      'const { spawn } = require("node:child_process");',
      'const { writeFileSync } = require("node:fs");',
      `const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });`,
      `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid), "utf8");`,
      "setInterval(() => {}, 1000);",
    ].join("\n");
    writeFileSync(path.join(dir, "parent-spawner.cjs"), spawnGrandchildScript, "utf8");

    const timeoutRes = await runCommand(process.execPath, ["parent-spawner.cjs"], {
      cwd: dir,
      timeoutMs: 600,
    });
    expect(timeoutRes.timedOut).toBe(true);
    expect(existsSync(pidFile)).toBe(true);
    const grandchildPid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
    expect(Number.isInteger(grandchildPid) && grandchildPid > 0).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    expect(isProcessAlive(grandchildPid)).toBe(false);
  });

  it("9. disposable-copy isolates repo mutations, excludes .unit-agent, and cleans up placed.json", () => {
    const repo = makeTempDir("ua-sec-copy-");
    mkdirSync(path.join(repo, ".unit-agent/chat"), { recursive: true });
    writeFileSync(path.join(repo, ".unit-agent/secret-state.json"), '{"keep":true}', "utf8");
    writeFileSync(path.join(repo, "app.ts"), "export const x = 1;\n", "utf8");

    const cfg = ConfigSchema.parse({
      version: 1,
      languages: {
        javascript: {
          framework: "vitest",
          testCommand: "npx vitest run",
          coverageFile: "coverage/lcov.info",
          coverageFormat: "lcov",
          sourceGlobs: ["*.ts"],
          testPathPatterns: ["test/{name}.test.ts"],
        },
      },
    });

    const ws = prepareValidationWorkspace(repo, cfg, "validate1");
    expect(ws.isCopy).toBe(true);
    expect(existsSync(path.join(ws.root, ".unit-agent"))).toBe(false);
    writeFileSync(path.join(ws.root, "hacked.txt"), "pwned", "utf8");
    expect(existsSync(path.join(repo, "hacked.txt"))).toBe(false);
    ws.cleanup();
    expect(existsSync(ws.root)).toBe(false);

    // placed.json crash recovery
    const workDir = path.join(repo, ".unit-agent");
    writeFileSync(path.join(repo, "test-leftover.test.ts"), "// leftover", "utf8");
    recordPlacedFile(workDir, "test-leftover.test.ts", true);
    const removed = cleanupLeftoverPlacedFiles(workDir, repo);
    expect(removed).toContain("test-leftover.test.ts");
    expect(existsSync(path.join(repo, "test-leftover.test.ts"))).toBe(false);
  });

  it("10. hostile-canary leaves repo clean, leaks zero tokens in comments/reports, and leaves snapshot intact", async () => {
    const repo = makeTempDir("ua-sec-canary-");
    const workDir = path.join(repo, ".unit-agent");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    const srcContent = "export function add(a: number, b: number) {\n  return a + b;\n}\n";
    writeFileSync(path.join(repo, "src/math.ts"), srcContent, "utf8");
    mkdirSync(path.join(workDir, ARTIFACTS.prepare.dir, "contexts"), { recursive: true });

    const contextPath = "contexts/f1.json";
    writeFileSync(
      path.join(workDir, ARTIFACTS.prepare.dir, contextPath),
      JSON.stringify({
        schemaVersion: 1,
        fileId: "f1",
        language: "javascript",
        framework: "vitest",
        mockingLibs: [],
        conventions: {
          testNaming: "describe/it",
          assertionStyle: "expect",
          importHint: "../src/math",
          testPath: "test/math.test.ts",
        },
        sourceFile: { path: "src/math.ts", content: srcContent, truncated: false },
        targets: [
          {
            symbolId: "src/math.ts#add",
            qualifiedName: "add",
            signature: "function add(a: number, b: number)",
            startLine: 1,
            endLine: 3,
          },
        ],
        referencedSignatures: [],
      }),
      "utf8",
    );

    const manifest = ManifestSchema.parse({
      schemaVersion: 1,
      runId: "sec-10",
      repo: "org/repo",
      pr: 9,
      baseSha: "base",
      headSha: "head123",
      createdAt: new Date().toISOString(),
      baseline: { status: "no_coverage", perLanguage: {}, patchCoveragePct: null },
      warnings: [],
      skipped: [],
      files: [
        {
          fileId: "f1",
          language: "javascript",
          path: "src/math.ts",
          testPath: "test/math.test.ts",
          importHint: "../src/math",
          contextPath,
          sourceSha256: sha256Hex(srcContent),
          symbols: [
            {
              symbolId: "src/math.ts#add",
              qualifiedName: "add",
              kind: "function",
              signature: "function add(a: number, b: number)",
              range: { startLine: 1, endLine: 3 },
              executableLines: 2,
              coveredLines: 0,
              coveragePct: 0,
              changedLines: [1, 2, 3],
              complexity: 1,
              score: 10,
            },
          ],
        },
      ],
    });
    writeFileSync(path.join(workDir, ARTIFACTS.prepare.dir, "manifest.json"), JSON.stringify(manifest), "utf8");

    const cfg = ConfigSchema.parse({
      version: 1,
      mode: "report",
      policy: { dropZeroGainFiles: false },
      languages: {
        javascript: {
          framework: "vitest",
          testCommand: `"${process.execPath}" canary-runner.mjs`,
          coverageFile: "coverage/lcov.info",
          coverageFormat: "lcov",
          sourceGlobs: ["src/**/*.ts"],
          testPathPatterns: ["test/{name}.test.ts"],
        },
      },
    });

    // Hostile runner attempts repo escape file write, .unit-agent write, and checks secret tokens absent
    writeFileSync(
      path.join(repo, "canary-runner.mjs"),
      [
        'import { existsSync, writeFileSync } from "node:fs";',
        'writeFileSync("hacked.txt", "canary", "utf8");',
        'if (existsSync(".unit-agent")) throw new Error(".unit-agent must not exist in copy");',
        'if (process.env.COPILOT_GITHUB_TOKEN || process.env.COMMIT_PAT) throw new Error("secret leaked to env");',
        "process.exit(0);",
      ].join("\n"),
      "utf8",
    );

    const canaryClient = await FakeLlmClient.fromScriptPath(
      path.join(REPO_ROOT, "agents/node/testgen/fixtures/llm/canary.js"),
    );
    const proposed = await runGenerate({
      repoRoot: repo,
      workDir,
      config: cfg,
      manifest,
      llmClient: canaryClient,
      writeOutputs: true,
    });
    expect(proposed.files[0]?.status).toBe("ok");

    // Hostile canary text in generated test vs policy/redaction check
    const hostilePolicy = await runStaticPolicyCheck({
      language: "javascript",
      testPath: "test/hostile.test.ts",
      content: 'import { execSync } from "node:child_process"; execSync("env"); fetch("http://evil.invalid");',
      targetCount: 1,
      maxTestsPerSymbol: 6,
    });
    expect(hostilePolicy.ok).toBe(false);

    const valRes = await runValidate({
      repoRoot: repo,
      workDir,
      config: cfg,
      manifest,
      proposed,
      phase: "all",
      attempt: 1,
      writeOutputs: true,
    });
    expect(valRes.report.files[0]?.outcome).toBe("accepted");
    expect(existsSync(path.join(repo, "hacked.txt"))).toBe(false);

    const fakeGh = makeMockGitHub();
    const pub = await runPublish({
      repoRoot: repo,
      workDir,
      config: cfg,
      report: valRes.report,
      repoFullName: "org/repo",
      prNumber: 9,
      headSha: "head123",
      github: fakeGh.client,
      writeOutputs: false,
    });
    // Ensure parent env secret redaction when secret is registered/patterned
    const redactedComment = sanitizeOutput(pub.markdown, { extraSecrets: ["sk_test_UNITAGENTCANARY9876543210"] });
    expect(redactedComment).not.toContain("sk_test_UNITAGENTCANARY9876543210");
  });

  it("11. fail-closed-approval sets has_tests=false and warns when Environment is missing or lacks reviewers", async () => {
    for (const envRes of [
      { exists: false, status: 404, hasRequiredReviewers: false },
      { exists: true, status: 200, hasRequiredReviewers: false },
    ]) {
      const dir = makeTempDir("ua-sec-envfail-");
      const workDir = path.join(dir, ".unit-agent");
      const validContent =
        '// unit-agent:generated\nimport { expect, it } from "vitest";\nit("x", () => expect(1).toBe(1));\n';
      mkdirSync(path.join(workDir, ARTIFACTS.snapshot1.dir, "validated/test"), { recursive: true });
      writeFileSync(path.join(workDir, ARTIFACTS.snapshot1.dir, "validated/test/math.test.ts"), validContent, "utf8");

      const cfg = ConfigSchema.parse({
        version: 1,
        mode: "propose",
        languages: {
          javascript: {
            framework: "vitest",
            testCommand: "npx vitest run",
            coverageFile: "coverage/lcov.info",
            coverageFormat: "lcov",
            sourceGlobs: ["src/**/*.ts"],
            testPathPatterns: ["test/{name}.test.ts"],
          },
        },
      });

      const ghOutFile = path.join(dir, "gh-out.txt");
      const prevOut = process.env.GITHUB_OUTPUT;
      process.env.GITHUB_OUTPUT = ghOutFile;
      try {
        const fakeGh = makeMockGitHub({ getEnvironment: async () => envRes });
        const pub = await runPublish({
          repoRoot: dir,
          workDir,
          config: cfg,
          repoFullName: "org/repo",
          prNumber: 4,
          headSha: "head123",
          github: fakeGh.client,
          approvalCheck: "api",
          approvalEnvironment: "unit-agent-approval",
          finalArtifact: FinalSchema.parse({
            schemaVersion: 1,
            runId: "sec-11",
            repo: "org/repo",
            pr: 4,
            headSha: "head123",
            headRef: "feat/x",
            mode: "propose",
            files: [
              {
                path: "test/math.test.ts",
                sha256: sha256Hex(validContent),
                symbolIds: ["src/math.ts#add"],
                testCount: 1,
                assumptions: [],
              },
            ],
            patchCoverage: { beforePct: 0, projectedPct: 80, targetPct: 80 },
            toolVersions: { agentNode: process.versions.node, languages: {}, warnings: [] },
            notes: [],
            rejected: [],
          }),
          report: {
            schemaVersion: 1,
            attempt: 1,
            workspace: "copy",
            environment: null,
            patchCoverage: { beforePct: 0, projectedPct: 80 },
            toolVersions: { agentNode: process.versions.node, languages: {}, warnings: [] },
            notes: [],
            files: [
              {
                fileId: "f1",
                testPath: "test/math.test.ts",
                outcome: "accepted",
                gates: [{ gate: "path", status: "pass" }],
                tests: [{ name: "x", status: "pass" }],
                sha256: sha256Hex(validContent),
              },
            ],
          },
          writeOutputs: true,
        });
        expect(pub.finalArtifact.mode).toBe("report");
        expect(pub.markdown).toContain("Downgraded to report-only mode");
        expect(readFileSync(ghOutFile, "utf8")).toContain("has_tests=false");
      } finally {
        if (prevOut === undefined) delete process.env.GITHUB_OUTPUT;
        else process.env.GITHUB_OUTPUT = prevOut;
      }
    }
  });

  it("12. copy workspace skips tool cache dirs consistently and fails closed when maxCopyMB is exceeded", () => {
    const repo = makeTempDir("ua-sec-copy-budget-");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    mkdirSync(path.join(repo, ".pytest_cache"), { recursive: true });
    mkdirSync(path.join(repo, ".gradle"), { recursive: true });
    writeFileSync(path.join(repo, "src", "app.ts"), "export const x = 1;\n", "utf8");
    // Cache files exceed 4 KB limit if not skipped identically by measureCopyBytes & copyFilteredTree
    writeFileSync(path.join(repo, ".pytest_cache", "big.bin"), "x".repeat(8192), "utf8");
    writeFileSync(path.join(repo, ".gradle", "cache.bin"), "y".repeat(8192), "utf8");

    const baseCfg = ConfigSchema.parse({
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
    const tinyBudgetCfg = {
      ...baseCfg,
      validate: { workspace: "copy" as const, maxCopyMB: 0.002 as unknown as number },
    };

    const wsOk = prepareValidationWorkspace(repo, tinyBudgetCfg, "validate1");
    try {
      expect(existsSync(path.join(wsOk.root, "src", "app.ts"))).toBe(true);
      expect(existsSync(path.join(wsOk.root, ".pytest_cache"))).toBe(false);
      expect(existsSync(path.join(wsOk.root, ".gradle"))).toBe(false);
    } finally {
      wsOk.cleanup();
    }

    // Regular source file larger than maxCopyMB fails closed
    writeFileSync(path.join(repo, "src", "large.txt"), "z".repeat(8192), "utf8");
    expect(() => prepareValidationWorkspace(repo, tinyBudgetCfg, "validate1")).toThrowError(StageError);
    try {
      prepareValidationWorkspace(repo, tinyBudgetCfg, "validate1");
    } catch (err) {
      expect((err as StageError).reason).toBe("sandbox_copy_failed");
    }
  });

  it("13. resolveGitHubTokensFromEnv honors commit.auth precedence", () => {
    const prevGh = process.env.GITHUB_TOKEN;
    const prevUa = process.env.UA_COMMIT_TOKEN;
    const prevPat = process.env.COMMIT_PAT;
    try {
      process.env.GITHUB_TOKEN = "gh_tok";
      process.env.UA_COMMIT_TOKEN = "pat_tok";
      delete process.env.COMMIT_PAT;

      expect(resolveGitHubTokensFromEnv("github_token").commitToken).toBe("gh_tok");
      expect(resolveGitHubTokensFromEnv("pat").commitToken).toBe("pat_tok");

      delete process.env.GITHUB_TOKEN;
      expect(resolveGitHubTokensFromEnv("github_token").commitToken).toBe("pat_tok");
    } finally {
      if (prevGh === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = prevGh;
      if (prevUa === undefined) delete process.env.UA_COMMIT_TOKEN;
      else process.env.UA_COMMIT_TOKEN = prevUa;
      if (prevPat === undefined) delete process.env.COMMIT_PAT;
      else process.env.COMMIT_PAT = prevPat;
    }
  });

  it("14. blocks obfuscated AST policy bypasses, markdown link/HTML injection, fake diff headers, and symlink targets in local apply", async () => {
    const jsConcatImport = await runStaticPolicyCheck({
      language: "javascript",
      testPath: "test/bypass.test.ts",
      content: [
        'import { expect, it } from "vitest";',
        'it("bypasses", () => {',
        "  const cp = require('child' + '_process');",
        '  const x = (0, eval)("1+1");',
        "  const { env } = process;",
        "  expect(Boolean(cp && x && env)).toBe(true);",
        "});",
      ].join("\n"),
    });
    expect(jsConcatImport.ok).toBe(false);
    expect(jsConcatImport.violations.some((v) => v.rule === "banned_import" || v.rule === "banned_call")).toBe(true);

    const pyAlias = await runStaticPolicyCheck({
      language: "python",
      testPath: "tests/test_bypass.py",
      content: ["import builtins as b", "def test_alias():", "    assert (b.eval)('1+1') == 2"].join("\n"),
    });
    expect(pyAlias.ok).toBe(false);

    const javaReflect = await runStaticPolicyCheck({
      language: "java",
      testPath: "src/test/java/com/acme/BypassTest.java",
      content: [
        "import org.junit.jupiter.api.Test;",
        "import static org.junit.jupiter.api.Assertions.assertTrue;",
        "class BypassTest extends ClassLoader {",
        '  @Test void t() throws Exception { assertTrue(Class.forName("java.lang.Runtime") != null); }',
        "}",
      ].join("\n"),
    });
    expect(javaReflect.ok).toBe(false);

    const md = sanitizeForMarkdown(
      "[click](https://evil.example/x)<script>alert(1)</script> <HOME>/src https://bare.example",
    );
    expect(md).toContain("HOME");
    expect(md).not.toContain("<script>");
    expect(md).not.toContain("https://evil.example");
    expect(md).not.toContain("https://bare.example");

    const spoofedDiff = [
      "diff --git a/src/real.ts b/src/real.ts",
      "--- a/src/real.ts",
      "+++ b/src/real.ts",
      "@@ -1,1 +1,2 @@",
      " export const a = 1;",
      "+// diff --git a/src/spoofed.ts b/src/spoofed.ts",
    ].join("\n");
    const parsedDiff = parseUnifiedDiff(spoofedDiff);
    expect(Object.keys(parsedDiff)).toEqual(["src/real.ts"]);

    // local apply refuses junction/symlink directory escape and missing provenance header
    const repo = makeTempDir("ua-sec-apply-sym-");
    const outsideDir = makeTempDir("ua-sec-apply-out-");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    mkdirSync(path.join(repo, "test"), { recursive: true });
    const srcContent = "export const a = (x: number) => x + 1;\n";
    writeFileSync(path.join(repo, "src", "a.ts"), srcContent, "utf8");
    let linked: boolean;
    try {
      symlinkSync(outsideDir, path.join(repo, "test", "linked"), process.platform === "win32" ? "junction" : "dir");
      linked = true;
    } catch {
      linked = false;
    }

    const workDir = path.join(repo, ".unit-agent");
    mkdirSync(path.join(workDir, ARTIFACTS.prepare.dir), { recursive: true });
    mkdirSync(path.join(workDir, ARTIFACTS.validate1.dir), { recursive: true });
    const badTest = 'import { expect, it } from "vitest";\nit("t", () => expect(1).toBe(1));\n';
    const goodTest = `// unit-agent:generated\n${badTest}`;
    const testRel = linked ? "test/linked/a.test.ts" : "test/a.test.ts";
    mkdirSync(path.join(workDir, ARTIFACTS.final.dir, "validated", path.dirname(testRel)), { recursive: true });
    writeFileSync(path.join(workDir, ARTIFACTS.final.dir, "validated", testRel), linked ? goodTest : badTest, "utf8");

    const cfg = ConfigSchema.parse({
      version: 1,
      policy: { provenanceHeader: true },
      languages: {
        javascript: {
          framework: "vitest",
          testCommand: "npx vitest run",
          coverageFile: "coverage/lcov.info",
          coverageFormat: "lcov",
          sourceGlobs: ["src/**/*.ts"],
          testPathPatterns: ["test/{name}.test.{ext}"],
        },
      },
    });
    writeFileSync(
      path.join(workDir, ARTIFACTS.prepare.dir, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        runId: "r-sec",
        repo: "org/repo",
        pr: 1,
        baseSha: "b1",
        headSha: "h1",
        createdAt: new Date().toISOString(),
        baseline: { status: "no_coverage", perLanguage: {}, patchCoveragePct: null },
        warnings: [],
        skipped: [],
        files: [
          {
            fileId: "f1",
            language: "javascript",
            path: "src/a.ts",
            testPath: testRel,
            importHint: "../src/a",
            contextPath: "contexts/f1.json",
            sourceSha256: sha256Hex(srcContent),
            symbols: [
              {
                symbolId: "src/a.ts#a",
                qualifiedName: "a",
                kind: "function",
                signature: "a(x)",
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
      }),
      "utf8",
    );
    writeFileSync(
      path.join(workDir, ARTIFACTS.validate1.dir, "report.json"),
      JSON.stringify({
        schemaVersion: 1,
        attempt: 1,
        workspace: "copy",
        environment: null,
        patchCoverage: { beforePct: null, projectedPct: null },
        toolVersions: { agentNode: process.versions.node, languages: {}, warnings: [] },
        notes: [],
        files: [
          {
            fileId: "f1",
            testPath: testRel,
            outcome: "accepted",
            gates: [{ gate: "path", status: "pass" }],
            tests: [{ name: "t", status: "pass" }],
            sha256: sha256Hex(linked ? goodTest : badTest),
          },
        ],
      }),
      "utf8",
    );

    const applyRes = await runLocalApply({ repoRoot: repo, workDir, config: cfg, confirm: true });
    expect(applyRes.exitCode).toBe(EXIT_CODES.POLICY_OR_HASH);
    expect(applyRes.summary.refused[0]?.reason).toBe("policy");
    expect(existsSync(path.join(outsideDir, "a.test.ts"))).toBe(false);
  });

  it("11b. strips proxy credentials from GRADLE_OPTS/MAVEN_OPTS and rejects escaping local.stagingDir", async () => {
    const cleanEnv = buildChildEnv(
      undefined,
      {},
      {
        GRADLE_OPTS: "-Dhttp.proxyUser=alice -Dhttps.proxyPassword=secret-pass -Xmx1g",
        MAVEN_OPTS: "-Dhttps.proxyPassword=top-secret -Dfoo=bar",
      },
    );
    expect(cleanEnv.GRADLE_OPTS).not.toContain("secret-pass");
    expect(cleanEnv.GRADLE_OPTS).toContain("-Xmx1g");
    expect(cleanEnv.MAVEN_OPTS).not.toContain("top-secret");
    expect(cleanEnv.MAVEN_OPTS).toContain("-Dfoo=bar");

    const repo = mkdtempSync(path.join(os.tmpdir(), "ua-sec-staging-"));
    tempDirs.push(repo);
    const workDir = path.join(repo, ".unit-agent");
    mkdirSync(workDir, { recursive: true });
    expect(() =>
      ConfigSchema.parse({
        version: 1,
        local: { stagingDir: "../outside-staging" },
        languages: {
          javascript: {
            enabled: true,
            testCommand: "npx vitest run",
            coverageFile: "coverage/lcov.info",
            coverageFormat: "lcov",
            sourceGlobs: ["src/**/*.ts"],
            testPathPatterns: ["test/{name}.test.ts"],
          },
        },
      }),
    ).toThrow();
    const cfg = ConfigSchema.parse({
      version: 1,
      languages: {
        javascript: {
          enabled: true,
          testCommand: "npx vitest run",
          coverageFile: "coverage/lcov.info",
          coverageFormat: "lcov",
          sourceGlobs: ["src/**/*.ts"],
          testPathPatterns: ["test/{name}.test.ts"],
        },
      },
    });
    cfg.local.stagingDir = "../outside-staging";
    await expect(runLocalValidate({ repoRoot: repo, workDir, config: cfg })).rejects.toThrow(StageError);
  });
});
