import { appendFileSync } from "node:fs";

export function writeStepSummary(markdown: string): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  appendFileSync(summaryPath, `${markdown.trimEnd()}\n\n`, "utf8");
}
