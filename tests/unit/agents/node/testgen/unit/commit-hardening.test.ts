import { describe, expect, it } from "vitest";

import { checkCommitPath, safeHeredocDelimiter } from "../../../../../../agents/node/testgen/src/core/commit-paths";
import { isBranchProtectionOrPermissionError } from "../../../../../../agents/node/testgen/src/github/commit";
import { isAuthErrorMessage } from "../../../../../../agents/node/testgen/src/llm/auth-errors";

describe("commit Gate 1 path policy", () => {
  it.each([
    "test/math.test.ts",
    "packages/app/test/smoke.test.ts",
    "src/test/java/com/acme/SampleServiceTest.java",
    "tests/test_calc_agent.py",
    "src/__tests__/util.spec.js",
  ])("allows %s", (p) => {
    expect(checkCommitPath(p).ok).toBe(true);
  });

  it.each([
    ".github/workflows/evil.yml",
    ".github/test/x.js",
    "package.json",
    "test/package.json",
    "pom.xml",
    "build.gradle",
    "conftest.py",
    "tests/conftest.py",
    ".unit-agent.yml",
    "src/index.js",
    "src/main/java/com/acme/Service.java",
    "../test/x.test.js",
    "/etc/test/x.test.js",
    "test\\x.test.js",
    "test//x.test.js",
    "test/x.test.sh",
    "node_modules/test/x.test.js",
    "test/jest.config.js",
  ])("rejects %s", (p) => {
    expect(checkCommitPath(p).ok).toBe(false);
  });
});

describe("heredoc delimiter", () => {
  it("never occurs in the patch", () => {
    const patch = "+line\n+UNIT_AGENT_PATCH_EOF\n+UNIT_AGENT_PATCH_EOF_X\n";
    const d = safeHeredocDelimiter(patch);
    expect(patch.includes(d)).toBe(false);
  });
});

describe("auth classification", () => {
  it("recognises real credential failures", () => {
    expect(
      isAuthErrorMessage("Authorization error. Your credentials may be expired or invalid. (Request ID: ABC)"),
    ).toBe(true);
    expect(isAuthErrorMessage("HTTP 401 Unauthorized")).toBe(true);
    expect(isAuthErrorMessage("Bad credentials")).toBe(true);
    expect(isAuthErrorMessage("The token is invalid")).toBe(true);
  });

  it("does not treat rate limits or unrelated text as auth", () => {
    expect(isAuthErrorMessage("403 secondary rate limit exceeded")).toBe(false);
    expect(isAuthErrorMessage("429 Too Many Requests")).toBe(false);
    expect(isAuthErrorMessage("context token limit reached")).toBe(false);
    expect(isAuthErrorMessage("Model did not invoke submit_tests tool")).toBe(false);
  });
});

describe("branch-protection fallback", () => {
  it("falls back only for genuine protection refusals", () => {
    expect(isBranchProtectionOrPermissionError(new Error("Protected branch update failed"))).toBe(true);
    expect(isBranchProtectionOrPermissionError(new Error("Resource not accessible by integration"))).toBe(true);
  });

  it("fails loudly for everything else", () => {
    expect(isBranchProtectionOrPermissionError(new Error("403 forbidden"))).toBe(false);
    expect(isBranchProtectionOrPermissionError(new Error("Expected branch to point to abc but it was def"))).toBe(
      false,
    );
    expect(isBranchProtectionOrPermissionError(Object.assign(new Error("Validation Failed"), { status: 422 }))).toBe(
      false,
    );
    expect(isBranchProtectionOrPermissionError(new Error("API rate limit exceeded"))).toBe(false);
  });
});
