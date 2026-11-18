import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ARTIFACTS,
  ConfigSchema,
  EXIT_CODES,
  FinalSchema,
  StageError,
  type Final,
  type GitHubClientLike,
} from "../../src/contracts";
import { sha256Hex } from "../../src/core/context";
import { parseEnvironmentProtectionRules, verifyRunApprovals } from "../../src/github";
import { runCommit } from "../../src/stages/commit";
import { renderPublishSummaryMarkdown, runPublish } from "../../src/stages/publish";
import { runCli } from "../../src/cli";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ua-gh-commit-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

const VALID_TEST_CONTENT = [
  "// unit-agent:generated",
  'import { expect, it } from "vitest";',
  'import { add } from "../src/math";',
  'it("adds positive integers", () => {',
  "  expect(add(2, 3)).toBe(5);",
  "});",
  "",
].join("\n");

function makeFinalFixture(workDir: string, content = VALID_TEST_CONTENT, headSha = "head123"): Final {
  const finalDir = path.join(workDir, ARTIFACTS.final.dir);
  const valPath = path.join(finalDir, "validated", "test/math.test.ts");
  mkdirSync(path.dirname(valPath), { recursive: true });
  writeFileSync(valPath, content, "utf8");
  writeFileSync(
    path.join(finalDir, "patch.diff"),
    "--- /dev/null\n+++ b/test/math.test.ts\n@@ -0,0 +1,1 @@\n+// diff\n",
    "utf8",
  );

  const finalObj = FinalSchema.parse({
    schemaVersion: 1,
    runId: "4242",
    repo: "acme/app",
    pr: 19,
    headSha,
    headRef: "feat/add-tests",
    mode: "propose",
    files: [
      {
        path: "test/math.test.ts",
        sha256: sha256Hex(content),
        symbolIds: ["src/math.ts#add"],
        testCount: 1,
        assumptions: [],
      },
    ],
    patchCoverage: { beforePct: 20, projectedPct: 90, targetPct: 70 },
    toolVersions: { agentNode: process.versions.node, languages: {}, warnings: [] },
    notes: [],
    rejected: [],
  });
  writeFileSync(path.join(finalDir, "final.json"), `${JSON.stringify(finalObj, null, 2)}\n`, "utf8");
  return finalObj;
}

function makeFakeGitHub(overrides: Partial<GitHubClientLike> = {}): {
  client: GitHubClientLike;
  comments: Array<{ id: number; body: string }>;
  commits: Array<{ headline: string; body: string; expectedHeadOid: string; additionsCount: number }>;
} {
  const comments: Array<{ id: number; body: string }> = [
    { id: 10, body: "<!-- unit-agent:v1 sha=head123 -->\nInitial summary" },
  ];
  const commits: Array<{ headline: string; body: string; expectedHeadOid: string; additionsCount: number }> = [];

  const client: GitHubClientLike = {
    getPullRequest: async () => ({
      headSha: "head123",
      headRef: "feat/add-tests",
      headRepoFullName: "acme/app",
      baseRepoFullName: "acme/app",
      draft: false,
      authorLogin: "pr-author",
      authorType: "User",
      labels: [],
      headCommitMessage: "feat: math",
    }),
    listIssueComments: async () => comments.map((c) => ({ ...c, userLogin: "github-actions[bot]" })),
    createIssueComment: async (_o, _r, _p, body) => {
      const id = comments.length + 100;
      comments.push({ id, body });
      return { id };
    },
    updateIssueComment: async (_o, _r, commentId, body) => {
      const hit = comments.find((c) => c.id === commentId);
      if (hit) hit.body = body;
    },
    getEnvironment: async () => ({ exists: true, status: 200, hasRequiredReviewers: true }),
    getRunApprovals: async () => ["reviewer-bob"],
    createCommitOnBranch: async (params) => {
      commits.push({
        headline: params.headline,
        body: params.body,
        expectedHeadOid: params.expectedHeadOid,
        additionsCount: params.additions.length,
      });
      return { oid: "commit-oid-999" };
    },
    ...overrides,
  };

  return { client, comments, commits };
}

describe("github integration & commit stage", () => {
  it("commits via GraphQL using separate commit client and records Approved-by trailer", async () => {
    const dir = makeTempDir();
    const workDir = path.join(dir, ".unit-agent");
    makeFinalFixture(workDir);

    const commentFake = makeFakeGitHub({
      createCommitOnBranch: async () => {
        throw new Error("comment client must not perform GraphQL commit when commitGithub is provided");
      },
    });
    const commitFake = makeFakeGitHub();

    const res = await runCommit({
      workDir,
      expectedHead: "head123",
      runId: 4242,
      runUrl: "https://github.com/acme/app/actions/runs/4242",
      github: commentFake.client,
      commitGithub: commitFake.client,
      writeOutputs: false,
    });

    expect(res.committed).toBe(true);
    expect(res.commitSha).toBe("commit-oid-999");
    expect(res.approvers).toEqual(["reviewer-bob"]);
    expect(commitFake.commits).toHaveLength(1);
    expect(commitFake.commits[0]?.headline).toBe("test: add unit tests for 1 file(s) [unit-agent]");
    expect(commitFake.commits[0]?.body).toContain("Approved-by: reviewer-bob");
    expect(commentFake.comments[0]?.body).toContain("Committed `commit-oid-999`");
  });

  it("exits 50 with PR comment when PR head changed before commit", async () => {
    const dir = makeTempDir();
    const workDir = path.join(dir, ".unit-agent");
    makeFinalFixture(workDir);

    const fake = makeFakeGitHub({
      getPullRequest: async () => ({
        headSha: "moved-sha-456",
        headRef: "feat/add-tests",
        headRepoFullName: "acme/app",
        baseRepoFullName: "acme/app",
        draft: false,
        authorLogin: "pr-author",
        authorType: "User",
        labels: [],
        headCommitMessage: "wip",
      }),
    });

    await expect(
      runCommit({
        workDir,
        expectedHead: "head123",
        runId: 4242,
        github: fake.client,
        writeOutputs: false,
      }),
    ).rejects.toMatchObject({
      code: EXIT_CODES.STALE_HEAD_OR_SOURCE,
    } satisfies Partial<StageError>);

    expect(fake.comments[0]?.body).toContain("PR changed after the tests were generated");
  });

  it("exits 60 on SHA-256 tamper or final head mismatch", async () => {
    const dir = makeTempDir();
    const workDir = path.join(dir, ".unit-agent");
    makeFinalFixture(workDir);
    writeFileSync(path.join(workDir, ARTIFACTS.final.dir, "validated", "test/math.test.ts"), "// tampered\n", "utf8");

    const fake = makeFakeGitHub();
    await expect(
      runCommit({
        workDir,
        expectedHead: "head123",
        runId: 4242,
        github: fake.client,
        writeOutputs: false,
      }),
    ).rejects.toMatchObject({
      code: EXIT_CODES.POLICY_OR_HASH,
      reason: "hash_mismatch",
    } satisfies Partial<StageError>);

    const dir2 = makeTempDir();
    const workDir2 = path.join(dir2, ".unit-agent");
    makeFinalFixture(workDir2, VALID_TEST_CONTENT, "other-head");
    await expect(
      runCommit({
        workDir: workDir2,
        expectedHead: "head123",
        runId: 4242,
        github: makeFakeGitHub().client,
        writeOutputs: false,
      }),
    ).rejects.toMatchObject({
      code: EXIT_CODES.POLICY_OR_HASH,
      reason: "head_sha_mismatch",
    } satisfies Partial<StageError>);
  });

  it("exits 60 on Gate 2 policy violation or self-approval", async () => {
    const dir = makeTempDir();
    const workDir = path.join(dir, ".unit-agent");
    const bannedContent = [
      'import fs from "node:fs";',
      'import { expect, it } from "vitest";',
      'it("bad", () => { expect(typeof fs.readFileSync).toBe("function"); });',
      "",
    ].join("\n");
    makeFinalFixture(workDir, bannedContent);

    await expect(
      runCommit({
        workDir,
        expectedHead: "head123",
        runId: 4242,
        github: makeFakeGitHub().client,
        writeOutputs: false,
      }),
    ).rejects.toMatchObject({
      code: EXIT_CODES.POLICY_OR_HASH,
      reason: "policy_violation",
    } satisfies Partial<StageError>);

    const dir2 = makeTempDir();
    const workDir2 = path.join(dir2, ".unit-agent");
    makeFinalFixture(workDir2);
    const selfApproved = makeFakeGitHub({
      getRunApprovals: async () => ["pr-author"],
    });

    await expect(
      runCommit({
        workDir: workDir2,
        expectedHead: "head123",
        runId: 4242,
        github: selfApproved.client,
        writeOutputs: false,
      }),
    ).rejects.toMatchObject({
      code: EXIT_CODES.POLICY_OR_HASH,
      reason: "approval_bypass",
    } satisfies Partial<StageError>);
  });

  it("allows self-approval iff environment allows it (preventSelfReview === false) and fails closed otherwise", async () => {
    expect(
      parseEnvironmentProtectionRules({
        protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{ id: 1 }] }],
      }),
    ).toEqual({ hasRequiredReviewers: true, preventSelfReview: false });

    expect(
      parseEnvironmentProtectionRules({
        protection_rules: [{ type: "required_reviewers", prevent_self_review: true, reviewers: [{ id: 1 }] }],
      }),
    ).toEqual({ hasRequiredReviewers: true, preventSelfReview: true });

    expect(
      parseEnvironmentProtectionRules({
        protection_rules: [{ type: "required_reviewers", reviewers: [{ id: 1 }] }],
      }),
    ).toEqual({ hasRequiredReviewers: true, preventSelfReview: true });

    expect(
      parseEnvironmentProtectionRules({
        protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [] }],
      }),
    ).toEqual({ hasRequiredReviewers: false, preventSelfReview: true });

    // Environment permits self-review -> runCommit succeeds with PR author's approval
    const dirAllowed = makeTempDir();
    const workDirAllowed = path.join(dirAllowed, ".unit-agent");
    makeFinalFixture(workDirAllowed);
    let queriedEnv = "";
    const selfAllowedFake = makeFakeGitHub({
      getRunApprovals: async () => ["pr-author"],
      getEnvironment: async (_o, _r, envName) => {
        queriedEnv = envName;
        return { exists: true, status: 200, hasRequiredReviewers: true, preventSelfReview: false };
      },
    });
    const commitRes = await runCommit({
      workDir: workDirAllowed,
      expectedHead: "head123",
      runId: 4242,
      approvalEnvironment: "custom-approval-env",
      github: selfAllowedFake.client,
      writeOutputs: false,
    });
    expect(queriedEnv).toBe("custom-approval-env");
    expect(commitRes.committed).toBe(true);
    expect(commitRes.approvers).toEqual(["pr-author"]);
    expect(selfAllowedFake.commits[0]?.body).toContain("Approved-by: pr-author");

    // Environment explicitly blocks self-review (preventSelfReview: true) -> exits 60
    const dirBlocked = makeTempDir();
    const workDirBlocked = path.join(dirBlocked, ".unit-agent");
    makeFinalFixture(workDirBlocked);
    const selfBlockedFake = makeFakeGitHub({
      getRunApprovals: async () => ["pr-author"],
      getEnvironment: async () => ({
        exists: true,
        status: 200,
        hasRequiredReviewers: true,
        preventSelfReview: true,
      }),
    });
    await expect(
      runCommit({
        workDir: workDirBlocked,
        expectedHead: "head123",
        runId: 4242,
        github: selfBlockedFake.client,
        writeOutputs: false,
      }),
    ).rejects.toMatchObject({
      code: EXIT_CODES.POLICY_OR_HASH,
      reason: "approval_bypass",
    } satisfies Partial<StageError>);

    // Environment missing / no reviewers / API failure -> always fail closed on self-approval
    for (const envStub of [
      () => Promise.resolve({ exists: false, status: 404, hasRequiredReviewers: false, preventSelfReview: false }),
      () => Promise.resolve({ exists: true, status: 200, hasRequiredReviewers: false, preventSelfReview: false }),
      () => Promise.reject(new Error("403 forbidden")),
    ]) {
      const outcome = await verifyRunApprovals({
        github: makeFakeGitHub({
          getRunApprovals: async () => ["PR-Author"],
          getEnvironment: envStub,
        }).client,
        owner: "acme",
        repo: "app",
        runId: 4242,
        prAuthorLogin: "pr-author",
      });
      expect(outcome.ok).toBe(false);
    }
  });

  it("falls back to posting patch.diff comment on branch protection failure", async () => {
    const dir = makeTempDir();
    const workDir = path.join(dir, ".unit-agent");
    makeFinalFixture(workDir);

    const fake = makeFakeGitHub({
      createCommitOnBranch: async () => {
        throw new Error("Protected branch update failed: required status checks missing");
      },
    });

    const res = await runCommit({
      workDir,
      expectedHead: "head123",
      runId: 4242,
      github: fake.client,
      writeOutputs: false,
    });

    expect(res.committed).toBe(false);
    expect(res.fallbackPatchPosted).toBe(true);
    expect(fake.comments[0]?.body).toContain("git apply");
    expect(fake.comments[0]?.body).toContain("--- /dev/null");
  });

  it("publish fails loud (soft_fail) when a succeeded job artifact is missing", async () => {
    const dir = makeTempDir();
    const workDir = path.join(dir, ".unit-agent");
    mkdirSync(path.join(workDir, ARTIFACTS.prepare.dir), { recursive: true });
    writeFileSync(
      path.join(workDir, ARTIFACTS.prepare.dir, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        runId: "r-missing",
        repo: "acme/app",
        pr: 22,
        baseSha: "base1",
        headSha: "head22",
        createdAt: new Date().toISOString(),
        baseline: { status: "no_coverage", perLanguage: {}, patchCoveragePct: null },
        files: [],
        warnings: [],
        skipped: [],
      }),
      "utf8",
    );

    const fake = makeFakeGitHub();
    const res = await runPublish({
      repoRoot: dir,
      workDir,
      config: ConfigSchema.parse({
        version: 1,
        mode: "propose",
        languages: {
          javascript: {
            enabled: true,
            testCommand: "npx vitest run",
            coverageFile: "coverage/lcov.info",
            coverageFormat: "lcov",
            sourceGlobs: ["src/**/*.ts"],
            testPathPatterns: ["test/{name}.test.{ext}"],
          },
        },
      }),
      jobResults: { prepare: "success", generate: "success", validate1: "success" },
      github: fake.client,
      writeOutputs: false,
    });

    expect(res.markdown).toContain("ua-proposed");
    expect(res.markdown).toContain("generate");
    const statusObj = JSON.parse(readFileSync(path.join(workDir, ARTIFACTS.final.dir, "status.json"), "utf8")) as {
      status: string;
    };
    expect(statusObj.status).toBe("soft_fail");
  });

  it("executes CLI commit without .unit-agent.yml on disk by reading final/resolved-config.json", async () => {
    const dir = makeTempDir();
    const workDir = path.join(dir, ".unit-agent");
    makeFinalFixture(workDir, VALID_TEST_CONTENT, "head-no-checkout");
    writeFileSync(
      path.join(workDir, ARTIFACTS.final.dir, "resolved-config.json"),
      JSON.stringify(
        ConfigSchema.parse({
          version: 1,
          mode: "propose",
          languages: {
            javascript: {
              enabled: true,
              testCommand: "npx vitest run",
              coverageFile: "coverage/lcov.info",
              coverageFormat: "lcov",
              sourceGlobs: ["src/**/*.ts"],
              testPathPatterns: ["test/{name}.test.{ext}"],
            },
          },
        }),
      ),
      "utf8",
    );

    const prevExit = process.exitCode;
    try {
      await runCli([
        "node",
        "cli.js",
        "--repo-root",
        dir,
        "--work-dir",
        workDir,
        "commit",
        "--expected-head",
        "head-no-checkout",
        "--dry-run",
      ]);
      expect(process.exitCode).toBe(EXIT_CODES.OK);
      const statusObj = JSON.parse(readFileSync(path.join(workDir, "commit", "status.json"), "utf8")) as {
        stage: string;
        status: string;
        reason: string;
      };
      expect(statusObj).toMatchObject({ stage: "commit", status: "ok", reason: "dry_run" });
    } finally {
      process.exitCode = prevExit;
    }
  });

  it("renders toolVersions/request footer and handles notice-only publish when .unit-agent.yml is absent", async () => {
    const dir = makeTempDir();
    const workDir = path.join(dir, ".unit-agent");
    mkdirSync(path.join(workDir, ARTIFACTS.prepare.dir), { recursive: true });
    writeFileSync(
      path.join(workDir, ARTIFACTS.prepare.dir, "notice.md"),
      "<!-- unit-agent:summary v1 pr=22 -->\n### Unit Agent — Notice\n\nNo config present.\n",
      "utf8",
    );

    const noticeRes = await runPublish({
      repoRoot: dir,
      workDir,
      prNumber: 22,
      repoFullName: "org/repo",
      headSha: "head22",
      dryRun: true,
      writeOutputs: false,
    });
    expect(noticeRes.finalArtifact.mode).toBe("report");
    expect(noticeRes.markdown).toContain("No config present.");

    // Also verify A6 tooling footer renders when report + final exist
    makeFinalFixture(workDir, VALID_TEST_CONTENT, "head-a6");
    mkdirSync(path.join(workDir, ARTIFACTS.validate1.dir), { recursive: true });
    writeFileSync(
      path.join(workDir, ARTIFACTS.validate1.dir, "report.json"),
      JSON.stringify({
        schemaVersion: 1,
        attempt: 1,
        workspace: "copy",
        environment: null,
        patchCoverage: { beforePct: 10, projectedPct: 90 },
        toolVersions: {
          agentNode: "v22.0.0",
          languages: {
            javascript: {
              runtime: { version: "20", source: "config" },
              framework: { name: "jest", version: "29.7.0", supported: true },
              tier: "tested",
            },
          },
          warnings: [],
        },
        notes: [],
        files: [],
      }),
      "utf8",
    );
    const fake = makeFakeGitHub();
    const pubRes = await runPublish({
      repoRoot: dir,
      workDir,
      config: ConfigSchema.parse({
        version: 1,
        mode: "report",
        languages: {
          javascript: {
            enabled: true,
            testCommand: "npx jest",
            coverageFile: "coverage/lcov.info",
            coverageFormat: "lcov",
            sourceGlobs: ["src/**/*.ts"],
            testPathPatterns: ["test/{name}.test.{ext}"],
          },
        },
      }),
      github: fake.client,
      dryRun: true,
      writeOutputs: false,
    });
    expect(pubRes.markdown).toContain("_Tooling: Agent Node");
    expect(pubRes.markdown).toContain("LLM requests: 0");

    const rendered = renderPublishSummaryMarkdown({
      finalArtifact: { ...makeFinalFixture(makeTempDir()), mode: "propose" },
      report: {
        schemaVersion: 1,
        attempt: 1,
        workspace: "copy",
        environment: null,
        patchCoverage: { beforePct: 10, projectedPct: 90 },
        toolVersions: { agentNode: "v22.0.0", languages: {}, warnings: [] },
        notes: [],
        files: [
          {
            fileId: "f1",
            testPath: "test/math.test.ts",
            outcome: "accepted",
            gates: [{ gate: "path", status: "pass" }],
            tests: [{ name: "adds", status: "pass" }],
            reason: undefined,
            sha256: "a".repeat(64),
          },
        ],
      },
      failedUpstreamJobs: ["build-$&-step"],
      approvalEnvironment: "unit-agent-approval",
    });
    expect(rendered).toContain("build-$&-step");
    expect(rendered).toContain("`unit-agent-approval`");
  });
});
