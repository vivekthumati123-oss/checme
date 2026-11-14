import type { StageName } from "./artifacts";

export const EXIT_CODES = {
  OK: 0,
  CONFIG_OR_INPUT: 20,
  INTERNAL: 30,
  SDK_OR_AUTH: 40,
  STALE_HEAD_OR_SOURCE: 50,
  POLICY_OR_HASH: 60,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export class StageError extends Error {
  readonly code: ExitCode;
  readonly stage: StageName | "config" | "guard" | "local";
  readonly reason?: string;

  constructor(message: string, code: ExitCode, stage: StageName | "config" | "guard" | "local", reason?: string) {
    super(message);
    this.name = "StageError";
    this.code = code;
    this.stage = stage;
    this.reason = reason;
  }
}

export class ConfigError extends StageError {
  constructor(message: string, reason = "invalid_config") {
    super(message, EXIT_CODES.CONFIG_OR_INPUT, "config", reason);
    this.name = "ConfigError";
  }
}

export class AuthError extends StageError {
  constructor(message: string, reason = "auth_failure") {
    super(message, EXIT_CODES.SDK_OR_AUTH, "generate", reason);
    this.name = "AuthError";
  }
}

export class TruncatedOutputError extends Error {
  readonly finishReason?: string;
  readonly rawPreview?: string;

  constructor(message: string, finishReason?: string, rawPreview?: string) {
    super(message);
    this.name = "TruncatedOutputError";
    this.finishReason = finishReason;
    this.rawPreview = rawPreview;
  }
}
