// =========================================================
// AZURE REPOS NORMALIZED ERROR
// =========================================================

export interface AzureReposScmError extends Error {
  status: number;
  code: string;
  provider: "azure-repos";
  operation: string;
  retryable: boolean;
}


// =========================================================
// AZURE REPOS ERROR MAPPER
//
// FR-SCM-011:
// Convert Azure-specific/API/network failures into a
// consistent SCM Bridge error structure.
// =========================================================

export class AzureReposErrorMapper {

  // =======================================================
  // MAP HTTP RESPONSE
  // =======================================================

  static fromHttpResponse(
    status: number,
    message: string,
    operation: string
  ): AzureReposScmError {

    switch (status) {

      case 400:
        return this.createError(
          400,
          "BAD_REQUEST",
          `Azure Repos request was invalid during ${operation}: ${message}`,
          operation,
          false
        );

      case 401:
        return this.createError(
          401,
          "AUTHENTICATION_FAILED",
          `Azure Repos authentication failed during ${operation}.`,
          operation,
          false
        );

      case 403:
        return this.createError(
          403,
          "AUTHORIZATION_FAILED",
          `Azure Repos authorization failed during ${operation}.`,
          operation,
          false
        );

      case 404:
        return this.createError(
          404,
          "NOT_FOUND",
          `Azure Repos resource was not found during ${operation}.`,
          operation,
          false
        );

      case 409:
        return this.createError(
          409,
          "CONFLICT",
          `Azure Repos conflict during ${operation}: ${message}`,
          operation,
          false
        );

      case 429:
        return this.createError(
          429,
          "RATE_LIMITED",
          `Azure Repos rate limit reached during ${operation}.`,
          operation,
          true
        );

      case 500:
      case 502:
      case 503:
      case 504:
        return this.createError(
          status,
          "PROVIDER_ERROR",
          `Azure Repos provider error during ${operation}: ${message}`,
          operation,
          true
        );

      default:
        return this.createError(
          status,
          "SCM_OPERATION_FAILED",
          `Azure Repos operation '${operation}' failed with status ${status}: ${message}`,
          operation,
          status >= 500
        );
    }
  }


  // =======================================================
  // MAP UNKNOWN / NETWORK / INTERNAL ERROR
  // =======================================================

  static map(
    error: unknown,
    operation: string
  ): AzureReposScmError {

    // -----------------------------------------------------
    // Error was already normalized.
    // Do not wrap it again.
    // -----------------------------------------------------

    if (
      error instanceof Error &&
      this.isNormalizedError(error)
    ) {
      return error;
    }


    // -----------------------------------------------------
    // Standard JavaScript / fetch error
    // -----------------------------------------------------

    if (
      error instanceof Error
    ) {

      return this.createError(
        500,
        "SCM_OPERATION_FAILED",
        `Azure Repos operation '${operation}' failed: ${error.message}`,
        operation,
        true
      );
    }


    // -----------------------------------------------------
    // Completely unknown thrown value
    // -----------------------------------------------------

    return this.createError(
      500,
      "SCM_OPERATION_FAILED",
      `Azure Repos operation '${operation}' failed.`,
      operation,
      true
    );
  }


  // =======================================================
  // CHECK WHETHER ERROR IS ALREADY NORMALIZED
  // =======================================================

  private static isNormalizedError(
    error: Error
  ): error is AzureReposScmError {

    const candidate =
      error as Partial<AzureReposScmError>;

    return (
      typeof candidate.status === "number" &&
      typeof candidate.code === "string" &&
      candidate.provider === "azure-repos" &&
      typeof candidate.operation === "string" &&
      typeof candidate.retryable === "boolean"
    );
  }


  // =======================================================
  // CREATE COMMON ERROR
  // =======================================================

  private static createError(
    status: number,
    code: string,
    message: string,
    operation: string,
    retryable: boolean
  ): AzureReposScmError {

    const error =
      new Error(
        message
      ) as AzureReposScmError;

    error.name =
      "AzureReposScmError";

    error.status =
      status;

    error.code =
      code;

    error.provider =
      "azure-repos";

    error.operation =
      operation;

    error.retryable =
      retryable;

    return error;
  }
}