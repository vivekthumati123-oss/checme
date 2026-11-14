import {
  ScmEvent
} from "../types/scmEvent";

import {
  GitLabUnknownEvent
} from "../events/gitlabEvent";

import {
  GitLabEventNormalizer
} from "../normalization/gitlabEventNormalizer";


export interface GitLabWebhookHeaders {

  event?:
    string;

  deliveryId?:
    string;
}


export class GitLabWebhookHandler {

  // =======================================================
  // HANDLE GITLAB WEBHOOK
  // =======================================================

  handle(
    payload: unknown,
    headers: GitLabWebhookHeaders = {}
  ): ScmEvent {

    const parsedPayload =
      this.parsePayload(
        payload
      );


    return GitLabEventNormalizer
      .normalize(
        parsedPayload,
        headers.deliveryId,
        headers.event
      );
  }


  // =======================================================
  // PARSE PAYLOAD
  // =======================================================

  private parsePayload(
    payload: unknown
  ): GitLabUnknownEvent {

    // -----------------------------------------------------
    // BUFFER PAYLOAD
    // -----------------------------------------------------

    if (
      Buffer.isBuffer(
        payload
      )
    ) {

      const text =
        payload.toString(
          "utf8"
        );


      return this.parseJson(
        text
      );
    }


    // -----------------------------------------------------
    // STRING PAYLOAD
    // -----------------------------------------------------

    if (
      typeof payload ===
      "string"
    ) {

      return this.parseJson(
        payload
      );
    }


    // -----------------------------------------------------
    // ALREADY-PARSED OBJECT
    // -----------------------------------------------------

    return this.assertObject(
      payload
    );
  }


  // =======================================================
  // PARSE JSON STRING
  // =======================================================

  private parseJson(
    text: string
  ): GitLabUnknownEvent {

    try {

      const parsed =
        JSON.parse(
          text
        ) as unknown;


      return this.assertObject(
        parsed
      );

    } catch (
      error
    ) {

      if (
        error instanceof Error &&
        error.message ===
          "Invalid GitLab webhook payload."
      ) {

        throw error;
      }


      throw new Error(
        "Invalid GitLab webhook JSON payload."
      );
    }
  }


  // =======================================================
  // VALIDATE OBJECT
  // =======================================================

  private assertObject(
    payload: unknown
  ): GitLabUnknownEvent {

    if (
      !payload ||
      typeof payload !==
        "object" ||
      Array.isArray(
        payload
      )
    ) {

      throw new Error(
        "Invalid GitLab webhook payload."
      );
    }


    return payload as GitLabUnknownEvent;
  }
}