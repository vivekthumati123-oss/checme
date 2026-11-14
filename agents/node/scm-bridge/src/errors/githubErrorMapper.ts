import {
  ScmError,
  ScmErrorCode
} from "./scmError";

export class GitHubErrorMapper {

  static async fromResponse(
    response: Response,
    operation: string
  ): Promise<ScmError> {

    const status =
      response.status;

    let providerMessage =
      response.statusText;

    try {

      const body =
        await response.clone().json() as {
          message?: string;
        };

      if (body.message) {
        providerMessage =
          body.message;
      }

    } catch {

      // Ignore non-JSON error responses.
    }


    /*
     * GitHub may return either 403 or 429
     * when API rate limits are exceeded.
     */
    const remaining =
      response.headers.get(
        "x-ratelimit-remaining"
      );

    const retryAfter =
      response.headers.get(
        "retry-after"
      );

    const rateLimited =
      status === 429 ||
      (
        status === 403 &&
        remaining === "0"
      ) ||
      (
        status === 403 &&
        providerMessage
          .toLowerCase()
          .includes("rate limit")
      );

    if (rateLimited) {

      const retryAfterSeconds =
        retryAfter
          ? Number(retryAfter)
          : undefined;

      return new ScmError(
        "RATE_LIMITED",
        providerMessage ||
          "GitHub API rate limit exceeded.",
        "github",
        operation,
        status,
        true,
        Number.isFinite(
          retryAfterSeconds
        )
          ? retryAfterSeconds
          : undefined
      );
    }


    const code:
      ScmErrorCode =
        this.mapStatus(
          status
        );

    const retryable =
      status >= 500;

    return new ScmError(
      code,
      providerMessage ||
        `GitHub request failed with status ${status}.`,
      "github",
      operation,
      status,
      retryable
    );
  }


  static network(
    operation: string,
    error: unknown
  ): ScmError {

    const message =
      error instanceof Error
        ? error.message
        : "Unknown network error.";

    return new ScmError(
      "NETWORK_ERROR",
      message,
      "github",
      operation,
      undefined,
      true
    );
  }


  private static mapStatus(
    status: number
  ): ScmErrorCode {

    switch (status) {

      case 401:
        return "AUTHENTICATION_FAILED";

      case 403:
        return "PERMISSION_DENIED";

      case 404:
        return "NOT_FOUND";

      case 409:
        return "CONFLICT";

      case 422:
        return "VALIDATION_FAILED";

      case 429:
        return "RATE_LIMITED";

      default:

        if (status >= 500) {
          return "SERVER_ERROR";
        }

        return "UNKNOWN_ERROR";
    }
  }
}