import { ScmProviderType } from "../types/scmProviderType";

export type ScmErrorCode =
  | "AUTHENTICATION_FAILED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";

export class ScmError extends Error {

  constructor(
    public readonly code: ScmErrorCode,
    message: string,
    public readonly provider: ScmProviderType,
    public readonly operation: string,
    public readonly status?: number,
    public readonly retryable = false,
    public readonly retryAfterSeconds?: number
  ) {

    super(message);

    this.name = "ScmError";
  }
}