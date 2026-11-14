import { ScmRepository } from "../types/scmRepository";
import { ScmBranch } from "../types/scmBranch";
import { ScmCommit } from "../types/scmCommit";
import { ScmPullRequest } from "../types/scmPullRequest";
import { ScmWebhook } from "../types/scmWebhook";


export interface GitHubRepositoryData {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  default_branch: string;
  private: boolean;
}


export interface GitHubBranchData {
  name: string;

  commit: {
    sha: string;
  };

  protected: boolean;
}


export interface GitHubCommitData {
  sha: string;
  html_url: string;

  commit: {
    message: string;

    author: {
      name: string;
      email: string;
      date: string;
    } | null;

    committer: {
      name: string;
      email: string;
      date: string;
    } | null;
  };
}


export interface GitHubPullRequestData {
  id: number;
  number: number;

  title: string;
  body: string | null;

  state: "open" | "closed";

  html_url: string;

  draft: boolean;

  merged_at: string | null;

  created_at: string;
  updated_at: string;

  user: {
    login: string;
  } | null;

  head: {
    ref: string;
    sha: string;
  };

  base: {
    ref: string;
    sha: string;
  };
}


export interface GitHubWebhookData {
  id: number;

  active: boolean;

  events: string[];

  config: {
    url?: string;
  };

  created_at?: string;
  updated_at?: string;
}


export class GitHubNormalizer {

  static repository(
    item: GitHubRepositoryData
  ): ScmRepository {

    return {
      id: item.id.toString(),
      name: item.name,
      fullName: item.full_name,
      url: item.html_url,
      cloneUrl: item.clone_url,
      defaultBranch: item.default_branch,
      private: item.private,
      provider: "github"
    };
  }


  static branch(
    item: GitHubBranchData
  ): ScmBranch {

    return {
      name: item.name,
      sha: item.commit.sha,
      protected: item.protected
    };
  }


  static commit(
    item: GitHubCommitData
  ): ScmCommit {

    return {
      sha: item.sha,

      message:
        item.commit.message,

      authorName:
        item.commit.author?.name,

      authorEmail:
        item.commit.author?.email,

      authorDate:
        item.commit.author?.date,

      committerName:
        item.commit.committer?.name,

      committerEmail:
        item.commit.committer?.email,

      committerDate:
        item.commit.committer?.date,

      url:
        item.html_url
    };
  }


  static pullRequest(
    item: GitHubPullRequestData
  ): ScmPullRequest {

    return {
      id: item.id.toString(),

      number:
        item.number,

      title:
        item.title,

      body:
        item.body ?? undefined,

      state:
        item.state,

      sourceBranch:
        item.head.ref,

      targetBranch:
        item.base.ref,

      sourceSha:
        item.head.sha,

      targetSha:
        item.base.sha,

      author:
        item.user?.login,

      draft:
        item.draft,

      merged:
        item.merged_at !== null,

      url:
        item.html_url,

      createdAt:
        item.created_at,

      updatedAt:
        item.updated_at
    };
  }


  static webhook(
    item: GitHubWebhookData
  ): ScmWebhook {

    return {
      id: item.id.toString(),

      active:
        item.active,

      url:
        item.config.url ?? "",

      events:
        item.events,

      createdAt:
        item.created_at,

      updatedAt:
        item.updated_at
    };
  }
}