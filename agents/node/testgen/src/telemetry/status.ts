import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ARTIFACTS, EXIT_CODES, StageError, type ExitCode, type StageName, type StageStatus } from "../contracts";
import { sanitizeOutput } from "./sanitize";

const GITHUB_OUTPUT_KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function writeGitHubOutput(outputs: Record<string, string | boolean | number>): void {
  const outPath = process.env.GITHUB_OUTPUT;
  if (!outPath) return;
  const lines: string[] = [];
  for (const [key, raw] of Object.entries(outputs)) {
    if (!GITHUB_OUTPUT_KEY_RE.test(key)) {
      throw new Error(`Invalid GITHUB_OUTPUT key: "${key}"`);
    }
    const val = String(raw);
    if (/[\r\n]/.test(val)) {
      let delimiter = `UA_EOF_${randomBytes(12).toString("hex")}`;
      while (val.includes(delimiter)) {
        delimiter = `UA_EOF_${randomBytes(12).toString("hex")}`;
      }
      const cleanVal = val.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      lines.push(`${key}<<${delimiter}\n${cleanVal}\n${delimiter}`);
    } else {
      lines.push(`${key}=${val}`);
    }
  }
  if (lines.length > 0) {
    appendFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
  }
}

export function writeStageStatus(workDir: string, status: StageStatus): string {
  const stageDirMap: Record<StageName, string> = {
    prepare: ARTIFACTS.prepare.dir,
    generate: ARTIFACTS.proposed.dir,
    validate1: ARTIFACTS.validate1.dir,
    repair: ARTIFACTS.repaired.dir,
    validate2: ARTIFACTS.validate2.dir,
    publish: ARTIFACTS.final.dir,
    commit: "commit",
  };
  const targetDir = path.join(workDir, stageDirMap[status.stage]);
  mkdirSync(targetDir, { recursive: true });
  const filePath = path.join(targetDir, "status.json");
  writeFileSync(filePath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  return filePath;
}

export function mapErrorToStageStatus(
  stage: StageName,
  err: unknown,
  repoRoot?: string,
): { exitCode: ExitCode; status: StageStatus } {
  if (err instanceof StageError) {
    const cleanReason = sanitizeOutput(err.reason ?? err.message, { repoRoot });
    const statusKind = err.code === EXIT_CODES.INTERNAL ? "error" : "soft_fail";
    return {
      exitCode: err.code,
      status: {
        stage,
        status: statusKind,
        reason: cleanReason,
        code: err.code === 0 ? undefined : err.code,
      },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    exitCode: EXIT_CODES.INTERNAL,
    status: {
      stage,
      status: "error",
      reason: sanitizeOutput(message, { repoRoot }),
      code: EXIT_CODES.INTERNAL,
    },
  };
}

/**
 * In GitHub Actions without `--strict`, convert exit codes 20/40/50/60 into
 * status.json + $GITHUB_OUTPUT status=soft_fail + exit 0 (D10, Section 5.9).
 */
export function resolveProcessExitCode(
  code: ExitCode,
  opts: { isGitHubActions?: boolean; strict?: boolean; isLocalCommand?: boolean } = {},
): ExitCode {
  if (code === EXIT_CODES.OK) return EXIT_CODES.OK;
  if (opts.isLocalCommand) return code;
  if (opts.strict) return code;
  const inActions = opts.isGitHubActions ?? process.env.GITHUB_ACTIONS === "true";
  if (!inActions) return code;
  if (
    code === EXIT_CODES.CONFIG_OR_INPUT ||
    code === EXIT_CODES.SDK_OR_AUTH ||
    code === EXIT_CODES.STALE_HEAD_OR_SOURCE ||
    code === EXIT_CODES.POLICY_OR_HASH
  ) {
    writeGitHubOutput({ status: "soft_fail" });
    return EXIT_CODES.OK;
  }
  writeGitHubOutput({ status: "error" });
  return code;
}
