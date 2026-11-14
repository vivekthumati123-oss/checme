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
  const status =
    err && typeof err === "object" && "status" in err && typeof (err as { status?: unknown }).status === "number"
      ? (err as { status: number }).status
      : 0;
  if (status === 403 || status === 422) return true;
  return (
    msg.includes("protected branch") ||
    msg.includes("branch protection") ||
    msg.includes("resource not accessible by integration") ||
    msg.includes("required status check") ||
    msg.includes("permission") ||
    msg.includes("not permitted") ||
    msg.includes("forbidden")
  );
}
