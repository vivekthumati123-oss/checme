import type { LanguageKey } from "../contracts";

export function inferLanguageForTestPath(testPath: string): LanguageKey {
  const lower = testPath.toLowerCase();
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".java")) return "java";
  return "javascript";
}

export function buildCommitHeadline(fileCount: number): string {
  return `test: add unit tests for ${fileCount} file(s) [unit-agent]`;
}

export function buildCommitBody(params: { runUrl?: string; approvers: string[] }): string {
  const lines = ["Generated and validated by unit-agent."];
  if (params.runUrl) {
    lines.push(`Run: ${params.runUrl}`);
  }
  for (const login of params.approvers) {
    lines.push(`Approved-by: ${login}`);
  }
  return lines.join("\n");
}

export function buildUnifiedNewFilePatch(entries: Array<{ path: string; content: string }>): string {
  const diffBlocks: string[] = [];
  for (const entry of entries) {
    const lines = entry.content.replace(/\r\n/g, "\n").split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    diffBlocks.push(
      `--- /dev/null\n+++ b/${entry.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`,
    );
  }
  return diffBlocks.join("\n");
}

export function isBranchProtectionOrPermissionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  // Only genuine branch-protection / ruleset / integration-permission refusals fall back to a patch.
  // Stale head, network, 422 validation, and rate limits must fail loudly.
  if (/rate limit|abuse|expectedheadoid|expected head|not up to date|was provided invalid/.test(msg)) return false;
  return (
    msg.includes("protected branch") ||
    msg.includes("branch protection") ||
    msg.includes("repository rule violations") ||
    msg.includes("required status check") ||
    msg.includes("resource not accessible by integration") ||
    msg.includes("must be made through a pull request") ||
    msg.includes("changes must be made through")
  );
}
