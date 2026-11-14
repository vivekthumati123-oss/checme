import "dotenv/config";

import express, {
  Request,
  Response
} from "express";

import {
  GitLabWebhookHandler
} from "./webhooks/gitlabWebhookHandler";

import {
  ScmProviderType
} from "./types/scmProviderType";

import {
  AzureReposEventNormalizer
} from "./normalization/azureReposEventNormalizer";

import {
  AzureReposEvent
} from "./events/azureReposEvent";

import {
  GitHubWebhookHandler
} from "./webhooks/githubWebhookHandler";

import {
  BitbucketWebhookHandler
} from "./webhooks/bitbucket/bitbucketWebhookHandler";

import {
  ProviderDetector
} from "./detection/providerDetector";

import {
  ProviderFactory
} from "./core/providerFactory";

import {
  EnvironmentCredentialProvider
} from "./auth/environmentCredentialProvider";


// =========================================================
// APPLICATION
// =========================================================

const app =
  express();


const PORT =
  Number(
    process.env.PORT ?? "3000"
  );


// =========================================================
// SCM SERVICES
// =========================================================

const providerDetector =
  new ProviderDetector();


const credentialProvider =
  new EnvironmentCredentialProvider();


// =========================================================
// WEBHOOK HANDLERS
// =========================================================

const githubWebhookHandler =
  new GitHubWebhookHandler();


const bitbucketWebhookHandler =
  new BitbucketWebhookHandler();

  const gitLabWebhookHandler =
new GitLabWebhookHandler();


const githubWebhookSecret =
  process.env.GITHUB_WEBHOOK_SECRET;


const bitbucketWebhookSecret =
  process.env.BITBUCKET_WEBHOOK_SECRET;


 app.post(
  "/webhooks/gitlab",

  express.json({
    type: "application/json"
  }),

  (
    request: Request,
    response: Response
  ) => {

    try {

      const rawEvent =
        request.header(
          "x-gitlab-event"
        ) ??
        undefined;


      const deliveryId =
        request.header(
          "x-gitlab-webhook-uuid"
        ) ??
        request.header(
          "x-gitlab-event-uuid"
        ) ??
        undefined;


      console.log(
        "GitLab req.body type:",
        typeof request.body
      );


      console.log(
        "GitLab req.body:",
        request.body
      );


      const event =
        gitLabWebhookHandler.handle(
          request.body,
          {
            event:
              rawEvent,

            deliveryId
          }
        );


      console.log(
        "GitLab SCM Event received:"
      );


      console.log(
        JSON.stringify(
          event,
          null,
          2
        )
      );


      response
        .status(200)
        .json({
          received:
            true,

          event
        });

    } catch (error) {

      console.error(
        "GitLab webhook processing error:",
        error
      );


      response
        .status(500)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "GitLab webhook processing failed."
        });
    }
  }
);
// =========================================================
// GITHUB WEBHOOK
// =========================================================

app.post(
  "/webhooks/github",

  express.raw({
    type: "application/json"
  }),

  (
    request: Request,
    response: Response
  ) => {

    try {

      if (!githubWebhookSecret) {

        response
          .status(503)
          .json({
            error:
              "GitHub webhook support is not configured."
          });

        return;
      }


      const signature =
        request.header(
          "x-hub-signature-256"
        );


      const eventType =
        request.header(
          "x-github-event"
        );


      const deliveryId =
        request.header(
          "x-github-delivery"
        );


      if (!eventType) {

        response
          .status(400)
          .json({
            error:
              "Missing X-GitHub-Event header."
          });

        return;
      }


      if (
        !Buffer.isBuffer(
          request.body
        )
      ) {

        response
          .status(400)
          .json({
            error:
              "Invalid webhook payload."
          });

        return;
      }


      const validSignature =
        githubWebhookHandler.verifySignature(
          request.body,
          signature,
          githubWebhookSecret
        );


      if (!validSignature) {

        response
          .status(401)
          .json({
            error:
              "Invalid webhook signature."
          });

        return;
      }


      const payload =
        JSON.parse(
          request.body.toString(
            "utf8"
          )
        ) as Record<string, any>;


      const event =
        githubWebhookHandler.normalizeEvent(
          eventType,
          deliveryId,
          payload
        );


      console.log(
        "GitHub SCM Event received:"
      );


      console.log(
        JSON.stringify(
          event,
          null,
          2
        )
      );


      response
        .status(200)
        .json({
          received: true,
          event
        });

    } catch (error) {

      console.error(
        "GitHub webhook processing error:",
        error
      );


      response
        .status(500)
        .json({
          error:
            "GitHub webhook processing failed."
        });
    }
  }
);


// =========================================================
// BITBUCKET WEBHOOK
// =========================================================

app.post(
  "/webhooks/bitbucket",

  express.raw({
    type: "application/json"
  }),

  (
    request: Request,
    response: Response
  ) => {

    try {

      if (!bitbucketWebhookSecret) {

        response
          .status(503)
          .json({
            error:
              "Bitbucket webhook support is not configured."
          });

        return;
      }


      const signature =
        request.header(
          "x-hub-signature"
        );


      const eventType =
        request.header(
          "x-event-key"
        );


      const deliveryId =
        request.header(
          "x-request-uuid"
        );


      if (!eventType) {

        response
          .status(400)
          .json({
            error:
              "Missing X-Event-Key header."
          });

        return;
      }


      if (
        !Buffer.isBuffer(
          request.body
        )
      ) {

        response
          .status(400)
          .json({
            error:
              "Invalid webhook payload."
          });

        return;
      }


      const validSignature =
        bitbucketWebhookHandler.verifySignature(
          request.body,
          signature,
          bitbucketWebhookSecret
        );


      if (!validSignature) {

        response
          .status(401)
          .json({
            error:
              "Invalid webhook signature."
          });

        return;
      }


      const payload =
        JSON.parse(
          request.body.toString(
            "utf8"
          )
        ) as Record<string, any>;


      const event =
        bitbucketWebhookHandler.normalizeEvent(
          eventType,
          deliveryId,
          payload
        );


      console.log(
        "Bitbucket SCM Event received:"
      );


      console.log(
        JSON.stringify(
          event,
          null,
          2
        )
      );


      response
        .status(200)
        .json({
          received: true,
          event
        });

    } catch (error) {

      console.error(
        "Bitbucket webhook processing error:",
        error
      );


      response
        .status(500)
        .json({
          error:
            "Bitbucket webhook processing failed."
        });
    }
  }
);


// =========================================================
// AZURE REPOS WEBHOOK
// =========================================================

app.post(
  "/api/scm/webhooks/azure-repos",

  express.json({
    type: "application/json"
  }),

  (
    request: Request,
    response: Response
  ) => {

    try {

      if (
        !request.body ||
        typeof request.body !== "object"
      ) {

        response
          .status(400)
          .json({
            error:
              "Invalid Azure Repos webhook payload."
          });

        return;
      }


      const payload =
        request.body as AzureReposEvent;


      if (
        !payload.eventType ||
        typeof payload.eventType !== "string"
      ) {

        response
          .status(400)
          .json({
            error:
              "Missing Azure DevOps eventType."
          });

        return;
      }


      if (
        payload.resource === undefined ||
        payload.resource === null
      ) {

        response
          .status(400)
          .json({
            error:
              "Missing Azure DevOps event resource."
          });

        return;
      }


      const event =
        AzureReposEventNormalizer.normalize(
          payload
        );


      console.log(
        "Azure Repos SCM Event received:"
      );


      console.log(
        JSON.stringify(
          event,
          null,
          2
        )
      );


      response
        .status(200)
        .json({
          received: true,
          event
        });

    } catch (error) {

      console.error(
        "Azure Repos webhook processing error:",
        error
      );


      response
        .status(500)
        .json({
          error:
            "Azure Repos webhook processing failed."
        });
    }
  }
);


// =========================================================
// SCM REST API: LIST REPOSITORIES
//
// Examples:
//
// /api/scm/repositories?provider=github
//
// /api/scm/repositories
//   ?provider=bitbucket
//   &workspace=my-workspace
//
// For Azure Repos, workspace can be used by the provider
// implementation for organization/project context.
// =========================================================

app.get(
  "/api/scm/repositories",

  async (
    request: Request,
    response: Response
  ) => {

    try {

      const providerQuery =
        request.query.provider;


      const workspaceQuery =
        request.query.workspace;


      if (
        typeof providerQuery !== "string" ||
        !providerQuery.trim()
      ) {

        response
          .status(400)
          .json({
            error:
              "provider query parameter is required."
          });

        return;
      }


      const requestedProvider =
        providerQuery.trim();


      if (
        requestedProvider !== "github" &&
        requestedProvider !== "bitbucket" &&
        requestedProvider !== "azure-repos" &&
        requestedProvider !== "gitlab"
      ) {

        response
          .status(400)
          .json({
            error:
              `Unsupported SCM provider: ${requestedProvider}`
          });

        return;
      }


      const scmProviderType:
        ScmProviderType =
          requestedProvider;


      if (
        workspaceQuery !== undefined &&
        typeof workspaceQuery !== "string"
      ) {

        response
          .status(400)
          .json({
            error:
              "workspace query parameter must be a string."
          });

        return;
      }


      const workspace =
        typeof workspaceQuery === "string" &&
        workspaceQuery.trim()
          ? workspaceQuery.trim()
          : undefined;


      const scmProvider =
        ProviderFactory.create(
          scmProviderType
        );


      const token =
        credentialProvider.getToken(
          scmProviderType
        );


      const repositories =
        await scmProvider.listRepositories(
          token,
          workspace
        );


      response
        .status(200)
        .json({
          provider:
            scmProviderType,

          count:
            repositories.length,

          repositories
        });

    } catch (error) {

      console.error(
        "SCM repositories API error:",
        error
      );


      if (
        error &&
        typeof error === "object" &&
        "status" in error
      ) {

        const scmError =
          error as {
            status?: number;
            code?: string;
            message?: string;
            provider?: string;
            operation?: string;
            retryable?: boolean;
          };


        const status =
          typeof scmError.status === "number"
            ? scmError.status
            : 500;


        response
          .status(status)
          .json({
            error:
              scmError.message ??
              "SCM repository listing failed.",

            code:
              scmError.code,

            provider:
              scmError.provider,

            operation:
              scmError.operation,

            retryable:
              scmError.retryable
          });

        return;
      }


      response
        .status(500)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "SCM repository listing failed."
        });
    }
  }
);


// =========================================================
// SCM REST API: LIST BRANCHES
// =========================================================

app.get(
  "/api/scm/branches",

  async (
    request: Request,
    response: Response
  ) => {

    try {

      const repositoryUrl =
        request.query.repositoryUrl;


      if (
        typeof repositoryUrl !== "string" ||
        !repositoryUrl.trim()
      ) {

        response
          .status(400)
          .json({
            error:
              "repositoryUrl query parameter is required."
          });

        return;
      }


      const providerType =
        providerDetector.detect(
          repositoryUrl
        );


      const provider =
        ProviderFactory.create(
          providerType
        );


      const token =
        credentialProvider.getToken(
          providerType
        );


      const branches =
        await provider.listBranches(
          token,
          repositoryUrl
        );


      response
        .status(200)
        .json({
          provider:
            providerType,

          repositoryUrl,

          count:
            branches.length,

          branches
        });

    } catch (error) {

      console.error(
        "SCM branches API error:",
        error
      );


      if (
        error &&
        typeof error === "object" &&
        "status" in error
      ) {

        const scmError =
          error as {
            status?: number;
            code?: string;
            message?: string;
            provider?: string;
            operation?: string;
            retryable?: boolean;
          };


        const status =
          typeof scmError.status === "number"
            ? scmError.status
            : 500;


        response
          .status(status)
          .json({
            error:
              scmError.message ??
              "SCM operation failed.",

            code:
              scmError.code,

            provider:
              scmError.provider,

            operation:
              scmError.operation,

            retryable:
              scmError.retryable
          });

        return;
      }


      response
        .status(500)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "SCM operation failed."
        });
    }
  }
);


// =========================================================
// SCM REST API: REPOSITORY TREE
// =========================================================

app.get(
  "/api/scm/tree",

  async (
    request: Request,
    response: Response
  ) => {

    try {

      const repositoryUrl =
        request.query.repositoryUrl;


      const ref =
        request.query.ref;


      if (
        typeof repositoryUrl !== "string" ||
        !repositoryUrl.trim()
      ) {

        response
          .status(400)
          .json({
            error:
              "repositoryUrl query parameter is required."
          });

        return;
      }


      if (
        ref !== undefined &&
        typeof ref !== "string"
      ) {

        response
          .status(400)
          .json({
            error:
              "ref query parameter must be a string."
          });

        return;
      }


      const providerType =
        providerDetector.detect(
          repositoryUrl
        );


      const provider =
        ProviderFactory.create(
          providerType
        );


      const token =
        credentialProvider.getToken(
          providerType
        );


      const tree =
        await provider.getRepositoryTree(
          token,
          repositoryUrl,
          ref
        );


      response
        .status(200)
        .json({
          provider:
            providerType,

          repositoryUrl,

          ref:
            ref ?? null,

          count:
            tree.length,

          tree
        });

    } catch (error) {

      console.error(
        "SCM repository tree API error:",
        error
      );


      response
        .status(500)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "SCM operation failed."
        });
    }
  }
);


// =========================================================
// SCM REST API: REPOSITORY CONTENT
// =========================================================

app.get(
  "/api/scm/content",

  async (
    request: Request,
    response: Response
  ) => {

    try {

      const repositoryUrl =
        request.query.repositoryUrl;


      const path =
        request.query.path;


      const ref =
        request.query.ref;


      if (
        typeof repositoryUrl !== "string" ||
        !repositoryUrl.trim()
      ) {

        response
          .status(400)
          .json({
            error:
              "repositoryUrl query parameter is required."
          });

        return;
      }


      if (
        typeof path !== "string" ||
        !path.trim()
      ) {

        response
          .status(400)
          .json({
            error:
              "path query parameter is required."
          });

        return;
      }


      if (
        ref !== undefined &&
        typeof ref !== "string"
      ) {

        response
          .status(400)
          .json({
            error:
              "ref query parameter must be a string."
          });

        return;
      }


      const providerType =
        providerDetector.detect(
          repositoryUrl
        );


      const provider =
        ProviderFactory.create(
          providerType
        );


      const token =
        credentialProvider.getToken(
          providerType
        );


      const content =
        await provider.getRepositoryContent(
          token,
          repositoryUrl,
          path,
          ref
        );


      response
        .status(200)
        .json({
          provider:
            providerType,

          repositoryUrl,

          path,

          ref:
            ref ?? null,

          count:
            content.length,

          content
        });

    } catch (error) {

      console.error(
        "SCM repository content API error:",
        error
      );


      response
        .status(500)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "SCM operation failed."
        });
    }
  }
);


// =========================================================
// SCM REST API: REPOSITORY METADATA
// =========================================================

app.get(
  "/api/scm/repository",

  async (
    request: Request,
    response: Response
  ) => {

    try {

      const repositoryUrl =
        request.query.repositoryUrl;


      if (
        typeof repositoryUrl !== "string" ||
        !repositoryUrl.trim()
      ) {

        response
          .status(400)
          .json({
            error:
              "repositoryUrl query parameter is required."
          });

        return;
      }


      const providerType =
        providerDetector.detect(
          repositoryUrl
        );


      const provider =
        ProviderFactory.create(
          providerType
        );


      const token =
        credentialProvider.getToken(
          providerType
        );


      const repository =
        await provider.getRepository(
          token,
          repositoryUrl
        );


      response
        .status(200)
        .json({
          provider:
            providerType,

          repository
        });

    } catch (error) {

      console.error(
        "SCM repository API error:",
        error
      );


      response
        .status(500)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "SCM operation failed."
        });
    }
  }
);


// =========================================================
// SCM REST API: COMMITS
// =========================================================

app.get(
  "/api/scm/commits",

  async (
    request: Request,
    response: Response
  ) => {

    try {

      const repositoryUrl =
        request.query.repositoryUrl;


      const ref =
        request.query.ref;


      if (
        typeof repositoryUrl !== "string" ||
        !repositoryUrl.trim()
      ) {

        response
          .status(400)
          .json({
            error:
              "repositoryUrl query parameter is required."
          });

        return;
      }


      if (
        ref !== undefined &&
        typeof ref !== "string"
      ) {

        response
          .status(400)
          .json({
            error:
              "ref query parameter must be a string."
          });

        return;
      }


      const providerType =
        providerDetector.detect(
          repositoryUrl
        );


      const provider =
        ProviderFactory.create(
          providerType
        );


      const token =
        credentialProvider.getToken(
          providerType
        );


      const commits =
        await provider.listCommits(
          token,
          repositoryUrl,
          ref
        );


      response
        .status(200)
        .json({
          provider:
            providerType,

          repositoryUrl,

          ref:
            ref ?? null,

          count:
            commits.length,

          commits
        });

    } catch (error) {

      console.error(
        "SCM commits API error:",
        error
      );


      response
        .status(500)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "SCM operation failed."
        });
    }
  }
);


// =========================================================
// SCM REST API: PULL REQUESTS
// =========================================================

app.get(
  "/api/scm/pull-requests",

  async (
    request: Request,
    response: Response
  ) => {

    try {

      const repositoryUrl =
        request.query.repositoryUrl;


      const state =
        request.query.state;


      if (
        typeof repositoryUrl !== "string" ||
        !repositoryUrl.trim()
      ) {

        response
          .status(400)
          .json({
            error:
              "repositoryUrl query parameter is required."
          });

        return;
      }


      if (
        state !== undefined &&
        state !== "open" &&
        state !== "closed" &&
        state !== "all"
      ) {

        response
          .status(400)
          .json({
            error:
              "state must be open, closed, or all."
          });

        return;
      }


      const providerType =
        providerDetector.detect(
          repositoryUrl
        );


      const provider =
        ProviderFactory.create(
          providerType
        );


      const token =
        credentialProvider.getToken(
          providerType
        );


      const pullRequests =
        await provider.listPullRequests(
          token,
          repositoryUrl,
          state
        );


      response
        .status(200)
        .json({
          provider:
            providerType,

          repositoryUrl,

          state:
            state ?? "open",

          count:
            pullRequests.length,

          pullRequests
        });

    } catch (error) {

      console.error(
        "SCM Pull Requests API error:",
        error
      );


      response
        .status(500)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "SCM operation failed."
        });
    }
  }
);


// =========================================================
// HEALTH
// =========================================================

app.get(
  "/health",

  (
    _request: Request,
    response: Response
  ) => {

    response
      .status(200)
      .json({
        status:
          "ok",

        service:
          "SCM Bridge"
      });
  }
);


// =========================================================
// SERVER
// =========================================================

app.listen(
  PORT,

  () => {

    console.log(
      `SCM Bridge listening on port ${PORT}`
    );


    console.log(
      `Health: http://localhost:${PORT}/health`
    );


    console.log(
      `SCM repositories API: http://localhost:${PORT}/api/scm/repositories`
    );


    console.log(
      `SCM branches API: http://localhost:${PORT}/api/scm/branches`
    );


    console.log(
      `SCM repository API: http://localhost:${PORT}/api/scm/repository`
    );


    console.log(
      `SCM repository tree API: http://localhost:${PORT}/api/scm/tree`
    );


    console.log(
      `SCM repository content API: http://localhost:${PORT}/api/scm/content`
    );


    console.log(
      `SCM commits API: http://localhost:${PORT}/api/scm/commits`
    );


    console.log(
      `SCM pull requests API: http://localhost:${PORT}/api/scm/pull-requests`
    );


    console.log(
      `GitHub webhook: http://localhost:${PORT}/webhooks/github`
    );


    console.log(
      `Bitbucket webhook: http://localhost:${PORT}/webhooks/bitbucket`
    );


    console.log(
      `Azure Repos webhook: http://localhost:${PORT}/api/scm/webhooks/azure-repos`
    );
  }
);