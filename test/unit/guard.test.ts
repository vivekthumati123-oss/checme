import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ConfigSchema, type GitHubClientLike } from "../../src/contracts";
import { runGuard, type PullRequestEventPayload } from "../../src/stages/guard";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ua-guard-"));
  tempDirs.push(dir);
  return dir;
}

const VALID_CFG = ConfigSchema.parse({
  version: 1,
  mode: "report",
  languages: {
    javascript: {
      testCommand: "npm test",
      coverageFile: "coverage/lcov.info",
      coverageFormat: "lcov",
      sourceGlobs: ["src/**/*.ts"],
      testPathPatterns: ["test/{name}.test.{ext}"],
    },
  },
});

function baseEvent(
  overrides: Partial<NonNullable<PullRequestEventPayload["pull_request"]>> = {},
): PullRequestEventPayload {
  return {
    action: "synchronize",
    number: 42,
    repository: { full_name: "acme/app" },
    pull_request: {
      number: 42,
      draft: false,
      head: { sha: "head123", ref: "feat/pay", repo: { full_name: "acme/app" } },
      base: { sha: "base000", ref: "main", repo: { full_name: "acme/app" } },
      user: { login: "alice", type: "User" },
      labels: [],
      head_commit: { message: "feat: add discount logic" },
      ...overrides,
    },
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("guard stage", () => {
  it("allows normal same-repo human PRs", async () => {
    const dir = makeTempDir();
    const res = await runGuard({
      repoRoot: dir,
      workDir: path.join(dir, ".unit-agent"),
      config: VALID_CFG,
      eventPayload: baseEvent(),
      writeOutputs: false,
    });
    expect(res.proceed).toBe(true);
    expect(res.reason).toBe("ok");
    expect(res.baseSha).toBe("base000");
    expect(res.headSha).toBe("head123");
    const statusJson = JSON.parse(readFileSync(path.join(dir, ".unit-agent", "prepare", "status.json"), "utf8"));
    expect(statusJson).toEqual({ stage: "prepare", status: "ok", reason: "ok" });
  });

  it("blocks fork PRs", async () => {
    const dir = makeTempDir();
    const res = await runGuard({
      repoRoot: dir,
      workDir: path.join(dir, ".unit-agent"),
      config: VALID_CFG,
      eventPayload: baseEvent({
        head: { sha: "h1", ref: "patch-1", repo: { full_name: "stranger/app" } },
      }),
      writeOutputs: false,
    });
    expect(res.proceed).toBe(false);
    expect(res.reason).toBe("fork_pr");
  });

  it("blocks draft and bot PRs unless unit-agent:run label is set, and honors unit-agent:skip", async () => {
    const dir = makeTempDir();
    const draftRes = await runGuard({
      repoRoot: dir,
      workDir: path.join(dir, ".unit-agent"),
      config: VALID_CFG,
      eventPayload: baseEvent({ draft: true }),
      writeOutputs: false,
    });
    expect(draftRes.proceed).toBe(false);
    expect(draftRes.reason).toBe("draft_pr");

    const draftOptIn = await runGuard({
      repoRoot: dir,
      workDir: path.join(dir, ".unit-agent"),
      config: VALID_CFG,
      eventPayload: baseEvent({ draft: true, labels: [{ name: "unit-agent:run" }] }),
      writeOutputs: false,
    });
    expect(draftOptIn.proceed).toBe(true);

    const botRes = await runGuard({
      repoRoot: dir,
      workDir: path.join(dir, ".unit-agent"),
      config: VALID_CFG,
      eventPayload: baseEvent({ user: { login: "dependabot[bot]", type: "Bot" } }),
      writeOutputs: false,
    });
    expect(botRes.proceed).toBe(false);
    expect(botRes.reason).toBe("bot_pr");

    const skipLabelRes = await runGuard({
      repoRoot: dir,
      workDir: path.join(dir, ".unit-agent"),
      config: VALID_CFG,
      eventPayload: baseEvent({ labels: [{ name: "unit-agent:skip" }, { name: "unit-agent:run" }] }),
      writeOutputs: false,
    });
    expect(skipLabelRes.proceed).toBe(false);
    expect(skipLabelRes.reason).toBe("skip_label");
  });

  it("blocks [skip unit-agent] and commit loop prefixes", async () => {
    const dir = makeTempDir();
    const skipMsg = await runGuard({
      repoRoot: dir,
      workDir: path.join(dir, ".unit-agent"),
      config: VALID_CFG,
      eventPayload: baseEvent({ head_commit: { message: "wip [skip unit-agent]" } }),
      writeOutputs: false,
    });
    expect(skipMsg.proceed).toBe(false);
    expect(skipMsg.reason).toBe("skip_commit_message");

    const loopMsg = await runGuard({
      repoRoot: dir,
      workDir: path.join(dir, ".unit-agent"),
      config: VALID_CFG,
      eventPayload: baseEvent({ head_commit: { message: "test(unit-agent): add unit tests" } }),
      writeOutputs: false,
    });
    expect(loopMsg.proceed).toBe(false);
    expect(loopMsg.reason).toBe("commit_loop");
  });

  it("rejects missing event shas with CONFIG_OR_INPUT", async () => {
    const dir = makeTempDir();
    const evPath = path.join(dir, "event.json");
    writeFileSync(evPath, JSON.stringify({ pull_request: { number: 1 } }), "utf8");
    await expect(
      runGuard({
        repoRoot: dir,
        workDir: path.join(dir, ".unit-agent"),
        config: VALID_CFG,
        eventPath: evPath,
        writeOutputs: false,
      }),
    ).rejects.toMatchObject({ code: 20 });
  });

  it("short-circuits with disabled when UNIT_AGENT_ENABLED=false", async () => {
    const dir = makeTempDir();
    const prev = process.env.UNIT_AGENT_ENABLED;
    try {
      process.env.UNIT_AGENT_ENABLED = "false";
      const disabledRes = await runGuard({
        repoRoot: dir,
        workDir: path.join(dir, ".unit-agent"),
        config: VALID_CFG,
        eventPayload: baseEvent(),
        writeOutputs: false,
      });
      expect(disabledRes.proceed).toBe(false);
      expect(disabledRes.reason).toBe("disabled");

      process.env.UNIT_AGENT_ENABLED = "true";
      const enabledRes = await runGuard({
        repoRoot: dir,
        workDir: path.join(dir, ".unit-agent"),
        config: VALID_CFG,
        eventPayload: baseEvent(),
        writeOutputs: false,
      });
      expect(enabledRes.proceed).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.UNIT_AGENT_ENABLED;
      else process.env.UNIT_AGENT_ENABLED = prev;
    }
  });

  it("replaces stale payload labels with live labels, blocks deleted forks, and skips invalid configs on fork PRs", async () => {
    const dir = makeTempDir();
    writeFileSync(path.join(dir, ".unit-agent.yml"), "not: [valid: yaml", "utf8");

    const forkRes = await runGuard({
      repoRoot: dir,
      workDir: path.join(dir, ".unit-agent"),
      eventPayload: baseEvent({
        head: { sha: "h1", ref: "patch-1", repo: { full_name: "evil-fork/app" } },
      }),
      writeOutputs: false,
    });
    expect(forkRes.proceed).toBe(false);
    expect(forkRes.reason).toBe("fork_pr");

    const fakeGithub: GitHubClientLike = {
      getPullRequest: async () => ({
        headSha: "head123",
        headRef: "feat/pay",
        headRepoFullName: "", // Deleted fork repo
        baseRepoFullName: "acme/app",
        draft: false,
        authorLogin: "alice",
        authorType: "User",
        labels: [],
        headCommitMessage: "feat",
      }),
      listIssueComments: async () => [],
      createIssueComment: async () => ({ id: 1 }),
      updateIssueComment: async () => {},
      getEnvironment: async () => ({ exists: false, status: 404, hasRequiredReviewers: false }),
      getRunApprovals: async () => [],
      createCommitOnBranch: async () => ({ oid: "x" }),
    };

    const deletedFork = await runGuard({
      repoRoot: dir,
      workDir: path.join(dir, ".unit-agent"),
      github: fakeGithub,
      eventPayload: baseEvent({ labels: [{ name: "unit-agent:skip" }] }),
      writeOutputs: false,
    });
    expect(deletedFork.proceed).toBe(false);
    expect(deletedFork.reason).toBe("fork_pr");

    // Live empty labels override stale payload skip label for same-repo PR
    const liveOkGithub: GitHubClientLike = {
      ...fakeGithub,
      getPullRequest: async () => ({
        headSha: "head123",
        headRef: "feat/pay",
        headRepoFullName: "acme/app",
        baseRepoFullName: "acme/app",
        draft: false,
        authorLogin: "alice",
        authorType: "User",
        labels: [],
        headCommitMessage: "feat",
      }),
    };
    const clearedLabelRes = await runGuard({
      repoRoot: dir,
      workDir: path.join(dir, ".unit-agent"),
      config: VALID_CFG,
      github: liveOkGithub,
      eventPayload: baseEvent({ labels: [{ name: "unit-agent:skip" }] }),
      writeOutputs: false,
    });
    expect(clearedLabelRes.proceed).toBe(true);
  });
});
