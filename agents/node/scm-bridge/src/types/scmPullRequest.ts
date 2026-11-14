export type ScmPullRequestState =
  | "open"
  | "closed";

export interface ScmPullRequest {
  id: string;
  number: number;

  title: string;
  body?: string;

  state: ScmPullRequestState;

  sourceBranch: string;
  targetBranch: string;

  sourceSha: string;
  targetSha: string;

  author?: string;

  draft: boolean;
  merged: boolean;

  url: string;

  createdAt?: string;
  updatedAt?: string;
}