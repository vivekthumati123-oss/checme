import type { FailureReason, LanguageKey } from "../../contracts";
import type { ExecResult } from "../../exec/exec";
import { matchToolchainMismatch } from "../../languages/toolchains";
import { stripTerminalEscapesAndControls } from "../../telemetry";
import { matchWrapperBootstrapFailure } from "./runners/java/detect";

const RUNNER_ENV_PATTERNS: readonly RegExp[] = [
  /\bunrecognized arguments:.*--cov\b/i,
  /\bNo module named ['"]?(?:pytest|pytest_cov|pytest-cov|coverage)['"]?/i,
  /\bPreset\s+.+?\s+not found\b/i,
  /\bTest environment\s+.+?\s+cannot be found\b/i,
  /Cannot find (?:module|package) ['"](?:ts-jest|babel-jest|jest|vitest|@vitest\/[^'"]+|jest-environment-[^'"]+|@jest\/[^'"]+)['"]/i,
];

const NETWORK_ENV_RE =
  /(?:Could not resolve|Could not GET|Connect to [^\r\n]+ failed|PKIX path building failed|Temporary failure in name resolution)/i;
const NETWORK_ERRNO_RE = /\b(?:ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN)\b/;
const NETWORK_CONTEXT_RE = /\b(?:npm|pip|pypi|registry|maven|gradle|downloading|fetch|proxy|ssl|tls|https?:)\b/i;

export function classifyExecutionFailure(
  execRes: ExecResult,
  language?: LanguageKey,
): {
  reason: FailureReason;
  detail: string;
} {
  const cleanStdout = stripTerminalEscapesAndControls(execRes.stdout);
  const cleanStderr = stripTerminalEscapesAndControls(execRes.stderr);
  const combined = `${cleanStdout}\n${cleanStderr}`;

  if (execRes.timedOut) {
    return { reason: "timeout", detail: `Command timed out: ${execRes.commandString}` };
  }

  if (execRes.spawnError) {
    return { reason: "tool_missing", detail: execRes.spawnError };
  }

  if (RUNNER_ENV_PATTERNS.some((pattern) => pattern.test(combined))) {
    return {
      reason: "environment_error",
      detail: "Test runner plugin, preset, or dependency is missing in the environment.",
    };
  }

  const mismatch = matchToolchainMismatch(combined, language);
  if (mismatch) {
    return { reason: mismatch.reason, detail: mismatch.detail };
  }

  const wrapperFail = matchWrapperBootstrapFailure(combined);
  if (wrapperFail.isWrapperError) {
    return {
      reason: "wrapper_unavailable",
      detail: wrapperFail.detail || "Build wrapper unavailable or failed to bootstrap.",
    };
  }

  if (NETWORK_ENV_RE.test(combined) || (NETWORK_ERRNO_RE.test(combined) && NETWORK_CONTEXT_RE.test(combined))) {
    return {
      reason: "environment_error",
      detail: "Network/proxy/TLS dependency resolution failure in runner.",
    };
  }

  if (
    /command not found|is not recognized as an internal or external command|No such file or directory/i.test(
      combined,
    ) &&
    !/AssertionError|AssertionFailedError|\bFAIL\b|\bERROR\b/.test(combined)
  ) {
    return {
      reason: "tool_missing",
      detail: "Configured test runner executable was not found.",
    };
  }

  if (
    /Cannot find module|ERR_MODULE_NOT_FOUND|ModuleNotFoundError|ImportError|package .* does not exist/i.test(combined)
  ) {
    return {
      reason: "import_error",
      detail: "Import or module resolution error in generated tests.",
    };
  }

  if (
    /\berror\s+TS\d+:|SyntaxError:|IndentationError:|TabError:|COMPILATION ERROR|error: cannot find symbol|Compilation failed|FAILURES?.*Compilation/i.test(
      combined,
    )
  ) {
    return {
      reason: "compile_error",
      detail: "Compilation or syntax error in generated tests.",
    };
  }

  return {
    reason: "generated_test_failure",
    detail: "One or more generated test cases failed during execution.",
  };
}
