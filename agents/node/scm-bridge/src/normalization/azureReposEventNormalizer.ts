import {
  ScmEvent
} from "../types/scmEvent";

import {
  AzureReposEvent,
  AzureReposPullRequestEventResource,
  AzureReposPushEventResource
} from "../events/azureReposEvent";


// =========================================================
// AZURE REPOS EVENT NORMALIZER
// =========================================================

export class AzureReposEventNormalizer {

  // =======================================================
  // NORMALIZE AZURE SERVICE HOOK EVENT
  // =======================================================

  static normalize(
    event: AzureReposEvent
  ): ScmEvent {

    switch (
      event.eventType
    ) {

      // =====================================================
      // PUSH
      // =====================================================

      case "git.push":

        return this.normalizePush(
          event
        );


      // =====================================================
      // PULL REQUEST CREATED
      // =====================================================

      case "git.pullrequest.created":

        return this.normalizePullRequest(
          event,
          "created"
        );


      // =====================================================
      // PULL REQUEST UPDATED
      // =====================================================

      case "git.pullrequest.updated":

        return this.normalizePullRequest(
          event,
          "updated"
        );


      // =====================================================
      // UNKNOWN EVENT
      // =====================================================

      default:

        return {
          id:
            event.id,

          deliveryId:
            event.id,

          provider:
            "azure-repos",

          type:
            "unknown",

          action:
            event.eventType,

          rawEventType:
            event.eventType,

          occurredAt:
            event.createdDate
        };
    }
  }


  // =======================================================
  // NORMALIZE PUSH EVENT
  // =======================================================

  private static normalizePush(
    event: AzureReposEvent
  ): ScmEvent {

    const resource =
      event.resource as
        AzureReposPushEventResource;


    const refUpdate =
      resource.refUpdates?.[0];


    return {

      id:
        event.id,

      deliveryId:
        event.id,

      provider:
        "azure-repos",

      type:
        "push",

      action:
        "push",

      rawEventType:
        event.eventType,


      // =====================================================
      // REPOSITORY
      // =====================================================

      repository:
        resource.repository
          ? {
              id:
                resource.repository.id,

              name:
                resource.repository.name
            }
          : undefined,


      repositoryId:
        resource.repository?.id,

      repositoryName:
        resource.repository?.name,


      // =====================================================
      // BRANCH
      // =====================================================

      branch:
        this.removeHeadsPrefix(
          refUpdate?.name
        ),


      // =====================================================
      // COMMITS
      // =====================================================

      beforeSha:
        refUpdate?.oldObjectId,

      afterSha:
        refUpdate?.newObjectId,


      // =====================================================
      // TIMESTAMP
      // =====================================================

      occurredAt:
        event.createdDate
    };
  }


  // =======================================================
  // NORMALIZE PULL REQUEST EVENT
  // =======================================================

  private static normalizePullRequest(
    event: AzureReposEvent,
    action:
      "created" |
      "updated"
  ): ScmEvent {

    const resource =
      event.resource as
        AzureReposPullRequestEventResource;


    return {

      id:
        event.id,

      deliveryId:
        event.id,

      provider:
        "azure-repos",


      // =====================================================
      // COMMON EVENT TYPE
      //
      // GitHub and Bitbucket already normalize PR events
      // using "pull_request".
      // =====================================================

      type:
        "pull_request",


      // =====================================================
      // NORMALIZED ACTION
      // =====================================================

      action,


      // =====================================================
      // ORIGINAL AZURE EVENT TYPE
      // =====================================================

      rawEventType:
        event.eventType,


      // =====================================================
      // REPOSITORY
      // =====================================================

      repository:
        resource.repository
          ? {
              id:
                resource.repository.id,

              name:
                resource.repository.name
            }
          : undefined,


      repositoryId:
        resource.repository?.id,

      repositoryName:
        resource.repository?.name,


      // =====================================================
      // PULL REQUEST
      // =====================================================

      pullRequestNumber:
        resource.pullRequestId,


      // =====================================================
      // SOURCE
      // =====================================================

      sourceBranch:
        this.removeHeadsPrefix(
          resource.sourceRefName
        ),

      sourceSha:
        resource.lastMergeSourceCommit
          ?.commitId,


      // =====================================================
      // TARGET
      // =====================================================

      targetBranch:
        this.removeHeadsPrefix(
          resource.targetRefName
        ),

      targetSha:
        resource.lastMergeTargetCommit
          ?.commitId,


      // =====================================================
      // TIMESTAMP
      // =====================================================

      occurredAt:
        event.createdDate
    };
  }


  // =======================================================
  // REMOVE refs/heads/ PREFIX
  // =======================================================

  private static removeHeadsPrefix(
    ref?: string
  ): string | undefined {

    if (
      !ref
    ) {

      return undefined;
    }


    return ref.replace(
      /^refs\/heads\//,
      ""
    );
  }
}