export interface ScmWebhook {
  id: string;

  active: boolean;

  url: string;

  events: string[];

  createdAt?: string;

  updatedAt?: string;
}