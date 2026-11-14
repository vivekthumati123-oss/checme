import {
  ScmError
} from "./scmError";


interface GitLabHttpError extends Error {
  status?: number;
  retryAfterSeconds?: number;
}


export class GitLabErrorMapper {

  static map(
    error: unknown,
    operation: string
  ): ScmError {

    if (
      error instanceof ScmError
    ) {
      return error;
    }


    if (
      error instanceof Error
    ) {

      const gitlabError =
        error as GitLabHttpError;


      const status =
        gitlabError.status;


      const retryAfterSeconds =
        gitlabError.retryAfterSeconds;


      switch (status) {

        case 400:
          return new ScmError(
            "VALIDATION_FAILED",
            error.message ||
              "Invalid GitLab request.",
            "gitlab",
            operation,
            status,
            false
          );


        case 401:
          return new ScmError(
            "AUTHENTICATION_FAILED",
            error.message ||
              "GitLab authentication failed.",
            "gitlab",
            operation,
            status,
            false
          );


        case 403:
          return new ScmError(
            "PERMISSION_DENIED",
            error.message ||
              "Permission denied by GitLab.",
            "gitlab",
            operation,
            status,
            false
          );


        case 404:
          return new ScmError(
            "NOT_FOUND",
            error.message ||
              "GitLab resource was not found.",
            "gitlab",
            operation,
            status,
            false
          );


        case 409:
          return new ScmError(
            "CONFLICT",
            error.message ||
              "GitLab resource conflict.",
            "gitlab",
            operation,
            status,
            false
          );


        case 422:
          return new ScmError(
            "VALIDATION_FAILED",
            error.message ||
              "GitLab validation failed.",
            "gitlab",
            operation,
            status,
            false
          );


        case 429:
          return new ScmError(
            "RATE_LIMITED",
            error.message ||
              "GitLab API rate limit exceeded.",
            "gitlab",
            operation,
            status,
            true,
            retryAfterSeconds
          );


        case 500:
        case 502:
        case 503:
        case 504:
          return new ScmError(
            "SERVER_ERROR",
            error.message ||
              "GitLab service error.",
            "gitlab",
            operation,
            status,
            true,
            retryAfterSeconds
          );
      }


      if (
        status === undefined
      ) {

        return new ScmError(
          "NETWORK_ERROR",
          error.message,
          "gitlab",
          operation,
          undefined,
          true
        );
      }


      return new ScmError(
        "UNKNOWN_ERROR",
        error.message ||
          "Unknown GitLab error.",
        "gitlab",
        operation,
        status,
        false
      );
    }


    return new ScmError(
      "UNKNOWN_ERROR",
      "Unknown GitLab error.",
      "gitlab",
      operation,
      undefined,
      false
    );
  }


  static fromHttpResponse(
    status: number,
    message: string,
    operation: string,
    retryAfterSeconds?: number
  ): ScmError {

    const error =
      new Error(
        message
      ) as GitLabHttpError;


    error.status =
      status;


    error.retryAfterSeconds =
      retryAfterSeconds;


    return GitLabErrorMapper.map(
      error,
      operation
    );
  }
}