import crypto from "crypto";

import {
  ScmEvent,
  ScmEventType
} from "../../types/scmEvent";


export class BitbucketWebhookHandler {

  // =========================================================
  // SIGNATURE VERIFICATION
  // =========================================================

  verifySignature(
    rawBody: Buffer,
    signature: string | undefined,
    secret: string
  ): boolean {

    if (!signature) {
      return false;
    }


    const expectedSignature =
      "sha256=" +
      crypto
        .createHmac(
          "sha256",
          secret
        )
        .update(rawBody)
        .digest("hex");


    const expectedBuffer =
      Buffer.from(
        expectedSignature,
        "utf8"
      );


    const receivedBuffer =
      Buffer.from(
        signature,
        "utf8"
      );


    if (
      expectedBuffer.length !==
      receivedBuffer.length
    ) {

      return false;
    }


    return crypto.timingSafeEqual(
      expectedBuffer,
      receivedBuffer
    );
  }


  // =========================================================
  // EVENT NORMALIZATION
  // =========================================================

  normalizeEvent(
    eventType: string,
    deliveryId: string | undefined,
    payload: Record<string, any>
  ): ScmEvent {

    const normalizedType =
      this.normalizeEventType(
        eventType
      );


    const repository =
      payload.repository;


    const actor =
      payload.actor;


    let branch:
      string | undefined;


    let action:
      string | undefined;


    // =======================================================
    // repo:push
    // =======================================================

    if (
      eventType === "repo:push"
    ) {

      const changes =
        payload.push?.changes;


      if (
        Array.isArray(changes) &&
        changes.length > 0
      ) {

        const firstChange =
          changes[0];


        branch =
          firstChange?.new?.name ??
          firstChange?.old?.name;
      }
    }


    // =======================================================
    // pullrequest events
    // =======================================================

    if (
      eventType.startsWith(
        "pullrequest:"
      )
    ) {

      branch =
        payload.pullrequest
          ?.source
          ?.branch
          ?.name;


      action =
        this.normalizePullRequestAction(
          eventType
        );
    }


    return {
      provider:
        "bitbucket",

      type:
        normalizedType,

      deliveryId,

      repository:
        repository
          ? {
              id:
                repository.uuid ??
                repository.id?.toString(),

              name:
                repository.name,

              fullName:
                repository.full_name,

              url:
                repository.links
                  ?.html
                  ?.href
            }
          : undefined,

      branch,

      action,

      sender:
        actor?.display_name ??
        actor?.nickname,

      rawEventType:
        eventType
    };
  }


  // =========================================================
  // PRIVATE HELPERS
  // =========================================================

  private normalizeEventType(
    eventType: string
  ): ScmEventType {

    switch (eventType) {

      case "repo:push":
        return "push";


      case "pullrequest:created":
      case "pullrequest:updated":
      case "pullrequest:approved":
      case "pullrequest:unapproved":
      case "pullrequest:fulfilled":
      case "pullrequest:rejected":
        return "pull_request";


      default:
        return "unknown";
    }
  }


  private normalizePullRequestAction(
    eventType: string
  ): string | undefined {

    switch (eventType) {

      case "pullrequest:created":
        return "opened";


      case "pullrequest:updated":
        return "updated";


      case "pullrequest:approved":
        return "approved";


      case "pullrequest:unapproved":
        return "unapproved";


      case "pullrequest:fulfilled":
        return "merged";


      case "pullrequest:rejected":
        return "closed";


      default:
        return undefined;
    }
  }
}