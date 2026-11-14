import {
  ScmEvent,
  ScmEventType
} from "../types/scmEvent";

import {
  GitLabUnknownEvent,
  GitLabPushEvent,
  GitLabMergeRequestEvent,
  isGitLabPushEvent,
  isGitLabMergeRequestEvent
} from "../events/gitlabEvent";


// =========================================================
// HELPERS
// =========================================================

function stripBranchPrefix(
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


function normalizeMergeRequestEventType(
  action?: string
): ScmEventType {

  switch (
    action
  ) {

    case "open":
      return "pull_request_created";

    case "update":
      return "pull_request_updated";

    case "merge":
      return "pull_request_updated";

    case "close":
      return "pull_request_updated";

    case "reopen":
      return "pull_request_updated";

    default:
      return "pull_request";
  }
}


// =========================================================
// NORMALIZER
// =========================================================

export class GitLabEventNormalizer {

  static normalize(
    payload: GitLabUnknownEvent,
    deliveryId?: string,
    rawEventType?: string
  ): ScmEvent {

    if (
      isGitLabPushEvent(
        payload
      )
    ) {

      return this.push(
        payload,
        deliveryId,
        rawEventType
      );
    }


    if (
      isGitLabMergeRequestEvent(
        payload
      )
    ) {

      return this.mergeRequest(
        payload,
        deliveryId,
        rawEventType
      );
    }


    return {
      provider:
        "gitlab",

      type:
        "unknown",

      deliveryId,

      rawEventType:
        rawEventType ??
        payload.object_kind ??
        payload.event_type ??
        payload.event_name,

      repository:
        {
          id:
            payload.project?.id?.toString(),

          name:
            payload.project?.name,

          fullName:
            payload.project
              ?.path_with_namespace,

          url:
            payload.project?.web_url
        },

      repositoryId:
        payload.project
          ?.id
          ?.toString(),

      repositoryName:
        payload.project?.name,

      sender:
        payload.user?.username ??
        payload.user?.name
    };
  }


  // =======================================================
  // PUSH
  // =======================================================

  private static push(
    payload: GitLabPushEvent,
    deliveryId?: string,
    rawEventType?: string
  ): ScmEvent {

    const latestCommit =
      payload.commits &&
      payload.commits.length > 0
        ? payload.commits[
            payload.commits.length - 1
          ]
        : undefined;


    return {
      provider:
        "gitlab",

      type:
        "push",

      deliveryId,

      rawEventType:
        rawEventType ??
        payload.event_name ??
        "Push Hook",

      repository:
        {
          id:
            payload.project
              ?.id
              ?.toString(),

          name:
            payload.project?.name,

          fullName:
            payload.project
              ?.path_with_namespace,

          url:
            payload.project?.web_url
        },

      repositoryId:
        payload.project
          ?.id
          ?.toString(),

      repositoryName:
        payload.project?.name,

      sender:
        payload.user_username ??
        payload.user_name,

      branch:
        stripBranchPrefix(
          payload.ref
        ),

      beforeSha:
        payload.before,

      afterSha:
        payload.after,

      occurredAt:
        latestCommit?.timestamp
    };
  }


  // =======================================================
  // MERGE REQUEST
  // =======================================================

  private static mergeRequest(
    payload: GitLabMergeRequestEvent,
    deliveryId?: string,
    rawEventType?: string
  ): ScmEvent {

    const attributes =
      payload.object_attributes;


    return {
      provider:
        "gitlab",

      type:
        normalizeMergeRequestEventType(
          attributes.action
        ),

      action:
        attributes.action,

      deliveryId,

      rawEventType:
        rawEventType ??
        payload.event_type ??
        "Merge Request Hook",

      repository:
        {
          id:
            payload.project
              ?.id
              ?.toString(),

          name:
            payload.project?.name,

          fullName:
            payload.project
              ?.path_with_namespace,

          url:
            payload.project?.web_url
        },

      repositoryId:
        payload.project
          ?.id
          ?.toString(),

      repositoryName:
        payload.project?.name,

      sender:
        payload.user?.username ??
        payload.user?.name,

      pullRequestNumber:
        attributes.iid,

      sourceBranch:
        attributes.source_branch,

      targetBranch:
        attributes.target_branch,

      sourceSha:
        attributes.last_commit?.id,

      occurredAt:
        attributes.updated_at ??
        attributes.created_at
    };
  }
}