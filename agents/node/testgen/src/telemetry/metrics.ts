import type { Metrics, ToolVersions } from "../contracts";

export function createInitialMetrics(params: {
  runId: string;
  repo: string;
  pr: number;
  sha: string;
  mode: string;
  agentVersion: string;
  toolVersions?: ToolVersions;
}): Metrics {
  return {
    runId: params.runId,
    repo: params.repo,
    pr: params.pr,
    sha: params.sha,
    mode: params.mode,
    agentVersion: params.agentVersion,
    durationMs: {},
    symbols: { detected: 0, selected: 0, covered: 0 },
    files: { selected: 0, generated: 0, accepted: 0, acceptedPruned: 0, rejected: 0 },
    tests: { generated: 0, kept: 0, pruned: 0, flakyRejected: 0 },
    repair: { attempted: 0, succeeded: 0 },
    coverage: { patchBeforePct: null, patchProjectedPct: null },
    llm: {
      requests: 0,
      retries: 0,
      inputChars: 0,
      outputChars: 0,
      failures: 0,
      truncated: 0,
      budgetStops: 0,
    },
    reasons: {},
    toolVersions: params.toolVersions ?? {
      agentNode: process.version,
      languages: {},
      warnings: [],
    },
    outcome: "no_work",
  };
}

export function incrementReasonCount(metrics: Metrics, reason: string | undefined): void {
  if (!reason) return;
  metrics.reasons[reason] = (metrics.reasons[reason] ?? 0) + 1;
}
