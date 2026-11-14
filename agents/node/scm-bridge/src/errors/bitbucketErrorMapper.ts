import {
  ScmError
} from "./scmError";


interface BitbucketHttpError extends Error {
  status?: number;
  retryAfterSeconds?: number;
}


export class BitbucketErrorMapper {

  static map(
    error: unknown,
    operation: string
  ): ScmError {

    /*
     * If the error has already been normalized,
     * return it unchanged.
     */
    if (error instanceof ScmError) {
      return error;
    }


    /*
     * Handle normal JavaScript errors,
     * including Bitbucket HTTP errors.
     */
    if (error instanceof Error) {

      const bitbucketError =
        error as BitbucketHttpError;


      const status =
        bitbucketError.status;


      const retryAfterSeconds =
        bitbucketError.retryAfterSeconds;


      switch (status) {

        // -----------------------------------------------------
        // Invalid request
        // -----------------------------------------------------

        case 400:
          return new ScmError(
            "VALIDATION_FAILED",
            error.message ||
              "Invalid Bitbucket request.",
            "bitbucket",
            operation,
            status,
            false
          );


        // -----------------------------------------------------
        // Authentication
        // -----------------------------------------------------

        case 401:
          return new ScmError(
            "AUTHENTICATION_FAILED",
            error.message ||
              "Bitbucket authentication failed.",
            "bitbucket",
            operation,
            status,
            false
          );


        // -----------------------------------------------------
        // Permission
        // -----------------------------------------------------

        case 403:
          return new ScmError(
            "PERMISSION_DENIED",
            error.message ||
              "Permission denied by Bitbucket.",
            "bitbucket",
            operation,
            status,
            false
          );


        // -----------------------------------------------------
        // Not found
        // -----------------------------------------------------

        case 404:
          return new ScmError(
            "NOT_FOUND",
            error.message ||
              "Bitbucket resource was not found.",
            "bitbucket",
            operation,
            status,
            false
          );


        // -----------------------------------------------------
        // Conflict
        // -----------------------------------------------------

        case 409:
          return new ScmError(
            "CONFLICT",
            error.message ||
              "Bitbucket resource conflict.",
            "bitbucket",
            operation,
            status,
            false
          );


        // -----------------------------------------------------
        // Validation
        // -----------------------------------------------------

        case 422:
          return new ScmError(
            "VALIDATION_FAILED",
            error.message ||
              "Bitbucket validation failed.",
            "bitbucket",
            operation,
            status,
            false
          );


        // -----------------------------------------------------
        // Rate limit
        // -----------------------------------------------------

        case 429:
          return new ScmError(
            "RATE_LIMITED",
            error.message ||
              "Bitbucket API rate limit exceeded.",
            "bitbucket",
            operation,
            status,
            true,
            retryAfterSeconds
          );


        // -----------------------------------------------------
        // Bitbucket server errors
        // -----------------------------------------------------

        case 500:
        case 502:
        case 503:
        case 504:
          return new ScmError(
            "SERVER_ERROR",
            error.message ||
              "Bitbucket service error.",
            "bitbucket",
            operation,
            status,
            true,
            retryAfterSeconds
          );
      }


      /*
       * When there is no HTTP status,
       * treat the failure as a network/runtime error.
       */
      if (
        status === undefined
      ) {

        return new ScmError(
          "NETWORK_ERROR",
          error.message,
          "bitbucket",
          operation,
          undefined,
          true
        );
      }


      /*
       * HTTP status exists but is not one
       * of the statuses handled above.
       */
      return new ScmError(
        "UNKNOWN_ERROR",
        error.message ||
          "Unknown Bitbucket error.",
        "bitbucket",
        operation,
        status,
        false
      );
    }


    /*
     * Something other than Error was thrown.
     */
    return new ScmError(
      "UNKNOWN_ERROR",
      "Unknown Bitbucket error.",
      "bitbucket",
      operation,
      undefined,
      false
    );
  }


  /**
   * Convert a Bitbucket HTTP response into
   * the SCM Bridge common error structure.
   */
  static fromHttpResponse(
    status: number,
    message: string,
    operation: string,
    retryAfterSeconds?: number
  ): ScmError {

    const error =
      new Error(
        message
      ) as BitbucketHttpError;


    error.status =
      status;


    error.retryAfterSeconds =
      retryAfterSeconds;


    return BitbucketErrorMapper.map(
      error,
      operation
    );
  }
}