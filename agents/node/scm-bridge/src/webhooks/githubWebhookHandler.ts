import crypto from "crypto";

import {
  ScmEvent,
  ScmEventType
} from "../types/scmEvent";

export class GitHubWebhookHandler {

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

    const sender =
      payload.sender;

    let branch:
      string | undefined;

    if (
      eventType === "push" &&
      typeof payload.ref === "string"
    ) {

      branch =
        payload.ref.replace(
          "refs/heads/",
          ""
        );
    }

    if (
      eventType === "pull_request"
    ) {

      branch =
        payload.pull_request
          ?.head
          ?.ref;
    }

    return {
      provider: "github",

      type:
        normalizedType,

      deliveryId,

      repository:
        repository
          ? {
              id:
                repository.id
                  ?.toString(),

              name:
                repository.name,

              fullName:
                repository.full_name,

              url:
                repository.html_url
            }
          : undefined,

      branch,

      action:
        payload.action,

      sender:
        sender?.login,

      rawEventType:
        eventType
    };
  }


  private normalizeEventType(
    eventType: string
  ): ScmEventType {

    switch (eventType) {

      case "ping":
        return "ping";

      case "push":
        return "push";

      case "pull_request":
        return "pull_request";

      default:
        return "unknown";
    }
  }
}