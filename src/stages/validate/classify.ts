import type { FailureReason } from "../../contracts";
import type { ExecResult } from "../../exec/exec";
import { matchToolchainMismatch } from "../../languages/toolchains";

export function classifyExecutionFailure(execRes: ExecResult): {
  reason: FailureReason;
  detail: string;
} {
  const combined = `${execRes.stdout}\n${execRes.stderr}`;

  if (execRes.timedOut) {
    return { reason: "timeout", detail: `Command timed out: ${execRes.commandString}` };
  }

  if (execRes.spawnError) {
    return { reason: "tool_missing", detail: execRes.spawnError };
  }

  const mismatch = matchToolchainMismatch(combined);
  if (mismatch) {
    return { reason: mismatch.reason, detail: mismatch.detail };
  }

  if (
    /Could not find or load main class org\.gradle\.wrapper/i.test(combined) ||
    /mvnw(?:\.cmd)?.*(?:not found|No such file|failed)/i.test(combined)
  ) {
    return {
      reason: "wrapper_unavailable",
      detail: "Build wrapper unavailable or failed to bootstrap.",
    };
  }

  if (
    /Could not resolve|Could not GET|Connect to .* failed|PKIX path building failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|Temporary failure in name resolution/i.test(
      combined,
    )
  ) {
    return {
      reason: "environment_error",
      detail: "Network/proxy/TLS dependency resolution failure in runner.",
    };
  }

  if (
    /command not found|is not recognized as an internal or external command|No such file or directory/i.test(
      combined,
    ) &&
    !/AssertionError|FAIL|ERROR/.test(execRes.stdout)
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
    /error TS\d+:|SyntaxError:|COMPILATION ERROR|error: cannot find symbol|Compilation failed|FAILURES?.*Compilation/i.test(
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
