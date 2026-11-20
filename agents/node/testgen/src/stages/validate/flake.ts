import { ENVIRONMENT_FAILURE_REASONS, type FailureReason, type FrameworkName } from "../../contracts";
import type { RunnerRequest, RunnerTestCase } from "./runners";
import { runSingleFileTests } from "./runners";

export interface FlakeCheckOutcome {
  ok: boolean;
  flakyTestNames: string[];
  runsExecuted: number;
  environmentFailure?: {
    reason: FailureReason;
    detail: string;
    command: string;
    output: string;
  };
}

export async function runFlakeCheck(params: {
  framework: FrameworkName;
  req: RunnerRequest;
  flakeRuns: number;
  passingTestNames: readonly string[];
}): Promise<FlakeCheckOutcome> {
  const extraRuns = Math.max(0, params.flakeRuns - 1);
  if (extraRuns === 0 || params.passingTestNames.length === 0) {
    return { ok: true, flakyTestNames: [], runsExecuted: 0 };
  }

  const flakySet = new Set<string>();
  let executed = 0;

  for (let i = 0; i < extraRuns; i += 1) {
    executed += 1;
    const res = await runSingleFileTests(params.framework, {
      ...params.req,
      withCoverage: false,
      isFlakeRerun: true,
    });

    if (res.timedOut || (res.failureReason && ENVIRONMENT_FAILURE_REASONS.has(res.failureReason))) {
      const reason: FailureReason = res.timedOut ? "timeout" : (res.failureReason ?? "environment_error");
      return {
        ok: false,
        flakyTestNames: [],
        runsExecuted: executed,
        environmentFailure: {
          reason,
          detail: res.failureDetail ?? "Runner encountered an environment failure during flake verification.",
          command: res.commandString,
          output: `${res.stdout}\n${res.stderr}`,
        },
      };
    }

    if (res.exitCode !== 0) {
      const failedInRun: RunnerTestCase[] = res.tests.filter((t) => t.status === "fail");
      if (failedInRun.length > 0) {
        for (const t of failedInRun) flakySet.add(t.name);
      } else {
        for (const name of params.passingTestNames) flakySet.add(name);
      }
    }
  }

  return {
    ok: flakySet.size === 0,
    flakyTestNames: [...flakySet],
    runsExecuted: executed,
  };
}
