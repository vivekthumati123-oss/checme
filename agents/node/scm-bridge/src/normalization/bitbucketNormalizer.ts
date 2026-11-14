import { ScmRepository } from "../types/scmRepository";
import { ScmBranch } from "../types/scmBranch";
import { ScmCommit } from "../types/scmCommit";
import { ScmPullRequest } from "../types/scmPullRequest";
import {
  ScmWebhook
} from "../types/scmWebhook";

export interface BitbucketBranchData {
  name: string;

  target: {
    hash: string;
  };
}
export interface BitbucketRepositoryData {
  uuid: string;
  name: string;
  full_name: string;
  is_private: boolean;

  links: {
    html: {
      href: string;
    };

    clone: Array<{
      href: string;
      name: string;
    }>;
  };

  mainbranch: {
    name: string;
  } | null;
}

export interface BitbucketCommitData {
  hash: string;
  message: string;
  date: string;

  author?: {
    raw?: string;

    user?: {
      display_name?: string;
    };
  };

  links?: {
    html?: {
      href: string;
    };
  };
}

export interface BitbucketPullRequestData {
  id: number;

  title: string;

  description?: string;

  state: string;

  created_on: string;

  updated_on: string;

  draft?: boolean;

  author?: {
    display_name?: string;
  };

  source: {
    branch: {
      name: string;
    };

    commit: {
      hash: string;
    };
  };

  destination: {
    branch: {
      name: string;
    };

    commit: {
      hash: string;
    };
  };

  merge_commit?: {
    hash?: string;
  } | null;

  links?: {
    html?: {
      href: string;
    };
  };
}

export interface BitbucketWebhookData {
  uuid: string;

  description?: string;

  url: string;

  active: boolean;

  events: string[];

  created_at?: string;

  subject_type?: string;
}
export class BitbucketNormalizer {

    static webhook(
  item: BitbucketWebhookData
): ScmWebhook {

  return {
    id:
      item.uuid,

    url:
      item.url,

    active:
      item.active,

    events:
      item.events
  };
}

    static pullRequest(
  item: BitbucketPullRequestData
): ScmPullRequest {

  const normalizedState =
    item.state.toUpperCase() === "OPEN"
      ? "open"
      : "closed";

  return {
    id:
      item.id.toString(),

    number:
      item.id,

    title:
      item.title,

    body:
      item.description,

    state:
      normalizedState,

    sourceBranch:
      item.source.branch.name,

    targetBranch:
      item.destination.branch.name,

    sourceSha:
      item.source.commit.hash,

    targetSha:
      item.destination.commit.hash,

    author:
      item.author?.display_name,

    draft:
      item.draft ?? false,

    merged:
      item.state.toUpperCase() === "MERGED",

    url:
      item.links?.html?.href ?? "",

    createdAt:
      item.created_on,

    updatedAt:
      item.updated_on
  };
}

    static commit(
  item: BitbucketCommitData
): ScmCommit {

  const authorName =
    item.author?.user?.display_name ??
    item.author?.raw;

  return {
    sha:
      item.hash,

    message:
      item.message,

    authorName,

    authorDate:
      item.date,

    committerName:
      authorName,

    committerDate:
      item.date,

    url:
      item.links?.html?.href
  };
}

    static branch(
  item: BitbucketBranchData
): ScmBranch {

  return {
    name: item.name,
    sha: item.target.hash,
    protected: false
  };
}

  static repository(
    item: BitbucketRepositoryData
  ): ScmRepository {

    const httpsCloneUrl =
      item.links.clone.find(
        (clone) =>
          clone.name === "https"
      )?.href;

      
    return {
      id:
        item.uuid,

      name:
        item.name,

      fullName:
        item.full_name,

      url:
        item.links.html.href,

      cloneUrl:
        httpsCloneUrl ??
        item.links.html.href,

      defaultBranch:
        item.mainbranch?.name ?? "",

      private:
        item.is_private,

      provider:
        "bitbucket"
    };
  }
}
