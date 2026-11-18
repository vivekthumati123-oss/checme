/**
 * Dependency-free commit-time path policy (Gate 1 at commit).
 * Validate already enforces configured testPathPatterns; commit re-checks a
 * conservative superset so a tampered `ua-final` artifact can never write
 * workflow, build, dependency, or source files.
 */

export interface CommitPathVerdict {
  ok: boolean;
  reason?: string;
}

const DENY_PREFIXES = [".github/", ".git/", ".unit-agent/", ".ua-agent/", ".vscode/", ".idea/", "node_modules/"];

const DENY_BASENAMES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "gradle.properties",
  "gradlew",
  "gradlew.bat",
  "mvnw",
  "mvnw.cmd",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "tox.ini",
  "pytest.ini",
  "conftest.py",
  "requirements.txt",
  "makefile",
  "dockerfile",
  "codeowners",
  ".unit-agent.yml",
  "jest.config.js",
  "jest.config.ts",
  "jest.config.mjs",
  "jest.config.cjs",
  "vitest.config.ts",
  "vitest.config.js",
  "vitest.config.mjs",
]);

const ALLOWED_EXT = /\.(?:[cm]?[jt]sx?|py|java)$/i;

/** A path must look like a test: a test-ish directory or a test-ish file name. */
const TESTISH = /(?:^|[/._-])(?:tests?|__tests__|specs?)(?:[/._-]|$)|Tests?\.java$/i;

export function checkCommitPath(rawPath: string): CommitPathVerdict {
  if (
    !rawPath ||
    rawPath.includes("\0") ||
    rawPath.includes("\\") ||
    rawPath.startsWith("/") ||
    /^[a-zA-Z]:/.test(rawPath)
  ) {
    return { ok: false, reason: "invalid path form" };
  }
  const segments = rawPath.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    return { ok: false, reason: "path contains empty, '.' or '..' segments" };
  }
  const lower = rawPath.toLowerCase();
  const prefix = DENY_PREFIXES.find((p) => lower.startsWith(p) || lower.includes(`/${p}`));
  if (prefix) return { ok: false, reason: `path is inside protected location "${prefix}"` };
  const base = (segments[segments.length - 1] ?? "").toLowerCase();
  if (DENY_BASENAMES.has(base)) return { ok: false, reason: `"${base}" is a protected build/config file` };
  if (!ALLOWED_EXT.test(base)) return { ok: false, reason: "only .js/.ts/.py/.java test files may be committed" };
  if (!TESTISH.test(rawPath)) return { ok: false, reason: "path does not look like a test file" };
  return { ok: true };
}

/** Pick a heredoc delimiter that does not occur in the patch text. */
export function safeHeredocDelimiter(patch: string): string {
  let delim = "UNIT_AGENT_PATCH_EOF";
  while (patch.includes(delim)) delim += "_X";
  return delim;
}
