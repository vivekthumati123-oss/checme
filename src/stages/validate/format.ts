import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { tokenizeCommand } from "../../config";
import type { LanguageConfig, LanguageKey, UnitAgentConfig } from "../../contracts";
import { sha256Hex } from "../../core/context";
import { fromRepoPath, isSafeRealPathInsideRoot } from "../../core/paths";
import { formatGeneratedTestContent } from "../../core/text/eol";
import { runCommand } from "../../exec/exec";
import { sanitizeFailureOutput } from "../../telemetry";

export interface FormatLintResult {
  ok: boolean;
  formattedContent: string;
  sha256: string;
  reason?: "lint_error" | "environment_error";
  detail?: string;
}

export async function runFormatAndLintGate(params: {
  workspaceRoot: string;
  repoRoot: string;
  language: LanguageKey;
  langConfig: LanguageConfig;
  config: UnitAgentConfig;
  testPath: string;
  content: string;
  referenceSourceContent?: string;
  runCommands?: boolean;
}): Promise<FormatLintResult> {
  let currentContent = formatGeneratedTestContent({
    content: params.content,
    language: params.language,
    repoRoot: params.repoRoot,
    targetPath: params.testPath,
    configEol: params.config.files.eol,
    provenanceHeader: params.config.policy.provenanceHeader,
    referenceSourceContent: params.referenceSourceContent,
  });

  const absTest = path.join(params.workspaceRoot, params.testPath);
  if (params.runCommands !== false && existsSync(absTest)) {
    if (!isSafeRealPathInsideRoot(params.testPath, params.workspaceRoot, { requireRegularFileIfExists: true })) {
      return {
        ok: false,
        formattedContent: currentContent,
        sha256: sha256Hex(currentContent),
        reason: "lint_error",
        detail: `Refusing to format or lint non-regular/symlink path "${params.testPath}".`,
      };
    }
    writeFileSync(absTest, currentContent, "utf8");
    const wdAbs = path.resolve(params.workspaceRoot, params.langConfig.workingDirectory || ".");
    const relFromWd = fromRepoPath(params.testPath, params.langConfig.workingDirectory);

    if (params.langConfig.formatCommand) {
      let fmtCmd: { file: string; args: string[] };
      try {
        fmtCmd = tokenizeCommand(params.langConfig.formatCommand, [relFromWd]);
      } catch (err) {
        return {
          ok: false,
          formattedContent: currentContent,
          sha256: sha256Hex(currentContent),
          reason: "environment_error",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
      const fmtRes = await runCommand(fmtCmd.file, fmtCmd.args, {
        cwd: wdAbs,
        timeoutMs: 60_000,
        config: params.config,
      });
      if (fmtRes.spawnError || fmtRes.exitCode !== 0) {
        const tail = sanitizeFailureOutput(`${fmtRes.stdout}\n${fmtRes.stderr}`, {
          repoRoot: params.workspaceRoot,
        });
        return {
          ok: false,
          formattedContent: currentContent,
          sha256: sha256Hex(currentContent),
          reason: fmtRes.spawnError ? "environment_error" : "lint_error",
          detail: tail || fmtRes.spawnError || `Format exited with code ${fmtRes.exitCode}`,
        };
      }
      if (isSafeRealPathInsideRoot(params.testPath, params.workspaceRoot, { requireRegularFileIfExists: true })) {
        currentContent = formatGeneratedTestContent({
          content: readFileSync(absTest, "utf8"),
          language: params.language,
          repoRoot: params.repoRoot,
          targetPath: params.testPath,
          configEol: params.config.files.eol,
          provenanceHeader: params.config.policy.provenanceHeader,
          referenceSourceContent: params.referenceSourceContent,
        });
        writeFileSync(absTest, currentContent, "utf8");
      }
    }

    if (params.langConfig.lintCommand) {
      let lintCmd: { file: string; args: string[] };
      try {
        lintCmd = tokenizeCommand(params.langConfig.lintCommand, [relFromWd]);
      } catch (err) {
        return {
          ok: false,
          formattedContent: currentContent,
          sha256: sha256Hex(currentContent),
          reason: "environment_error",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
      const lintRes = await runCommand(lintCmd.file, lintCmd.args, {
        cwd: wdAbs,
        timeoutMs: 60_000,
        config: params.config,
      });
      if (lintRes.spawnError || lintRes.exitCode !== 0) {
        const tail = sanitizeFailureOutput(`${lintRes.stdout}\n${lintRes.stderr}`, {
          repoRoot: params.workspaceRoot,
        });
        return {
          ok: false,
          formattedContent: currentContent,
          sha256: sha256Hex(currentContent),
          reason: lintRes.spawnError ? "environment_error" : "lint_error",
          detail: tail || lintRes.spawnError || `Lint exited with code ${lintRes.exitCode}`,
        };
      }
    }
  }

  return {
    ok: true,
    formattedContent: currentContent,
    sha256: sha256Hex(currentContent),
  };
}
