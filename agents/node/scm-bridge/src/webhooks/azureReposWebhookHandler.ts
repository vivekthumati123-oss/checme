import {
  ScmEvent
} from "../types/scmEvent";

import {
  AzureReposEvent
} from "../events/azureReposEvent";

import {
  AzureReposEventNormalizer
} from "../normalization/azureReposEventNormalizer";


export class AzureReposWebhookHandler {

  handle(
    payload: unknown
  ): ScmEvent {

    if (
      !payload ||
      typeof payload !==
      "object"
    ) {

      throw new Error(
        "Invalid Azure Repos webhook payload."
      );
    }


    const event =
      payload as AzureReposEvent;


    if (
      !event.eventType
    ) {

      throw new Error(
        "Azure Repos webhook eventType is required."
      );
    }


    return AzureReposEventNormalizer.normalize(
      event
    );
  }
}