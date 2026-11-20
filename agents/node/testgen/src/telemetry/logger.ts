import { mkdirSync } from "node:fs";
import path from "node:path";
import pino from "pino";

import type { LoggerLike, StageName } from "../contracts";

export function createStageLogger(params: {
  workDir: string;
  stage: StageName | "cli";
  runId: string;
  pr: number;
  sha: string;
  silent?: boolean;
}): LoggerLike {
  const logsDir = path.join(params.workDir, "logs");
  mkdirSync(logsDir, { recursive: true });
  const logFile = path.join(logsDir, `${params.stage}.jsonl`);

  const streams: pino.StreamEntry[] = [{ stream: pino.destination({ dest: logFile, sync: true }) }];
  if (!params.silent) {
    // Send structured logs to stderr so `--json` local commands keep stdout strictly single-JSON.
    streams.push({ stream: process.stderr });
  }

  const base = pino(
    {
      level: process.env.UA_LOG_LEVEL ?? "info",
      base: {
        runId: params.runId,
        pr: params.pr,
        sha: params.sha,
        stage: params.stage,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams),
  );

  const wrap = (inst: pino.Logger): LoggerLike => ({
    info: (obj, msg) => inst.info(obj, msg),
    warn: (obj, msg) => inst.warn(obj, msg),
    error: (obj, msg) => inst.error(obj, msg),
    debug: (obj, msg) => inst.debug(obj, msg),
    child: (bindings) => wrap(inst.child(bindings)),
  });

  return wrap(base);
}

export function createNoopLogger(): LoggerLike {
  const noop: LoggerLike = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    child: () => noop,
  };
  return noop;
}
