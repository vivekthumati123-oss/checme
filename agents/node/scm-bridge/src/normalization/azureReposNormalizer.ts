import {
  ScmRepository
} from "../types/scmRepository";

import {
  ScmCommit
} from "../types/scmCommit";

import {
  ScmPullRequest
} from "../types/scmPullRequest";


// =========================================================
// AZURE REPOS REPOSITORY DATA
// =========================================================

export interface AzureReposRepositoryData {

  id: string;

  name: string;

  url: string;

  remoteUrl?: string;

  webUrl?: string;

  defaultBranch?: string;

  project: {

    id: string;

    name: string;
  };
}


// =========================================================
// AZURE REPOS COMMIT DATA
// =========================================================

export interface AzureReposCommitData {

  commitId: string;

  author: {

    name: string;

    email: string;

    date: string;
  };

  committer: {

    name: string;

    email: string;

    date: string;
  };

  comment: string;

  url?: string;

  remoteUrl?: string;
}


// =========================================================
// AZURE REPOS PULL REQUEST DATA
// =========================================================

export interface AzureReposPullRequestData {

  pullRequestId: number;

  title: string;

  description?: string;

  status: string;

  creationDate?: string;

  closedDate?: string;

  sourceRefName: string;

  targetRefName: string;

  isDraft?: boolean;

  url?: string;

  createdBy?: {

    displayName?: string;

    uniqueName?: string;
  };

  lastMergeSourceCommit?: {

    commitId: string;
  };

  lastMergeTargetCommit?: {

    commitId: string;
  };

  repository?: {

    id: string;

    name: string;

    webUrl?: string;

    remoteUrl?: string;
  };
}


// =========================================================
// AZURE REPOS NORMALIZER
// =========================================================

export class AzureReposNormalizer {


  // =======================================================
  // FR-SCM-003 / FR-SCM-010
  // REPOSITORY NORMALIZATION
  // =======================================================

  static repository(
    data: AzureReposRepositoryData
  ): ScmRepository {

    return {

      id:
        data.id,

      name:
        data.name,

      fullName:
        `${data.project.name}/${data.name}`,

      url:
        data.webUrl ||
        data.remoteUrl ||
        data.url,

      cloneUrl:
        data.remoteUrl ||
        data.webUrl ||
        data.url,

      defaultBranch:
        String(
          data.defaultBranch ||
          "main"
        ).replace(
          /^refs\/heads\//,
          ""
        ),

      private:
        true,

      provider:
        "azure-repos"
    };
  }


  // =======================================================
  // FR-SCM-007 / FR-SCM-010
  // COMMIT NORMALIZATION
  // =======================================================

  static commit(
    data: AzureReposCommitData
  ): ScmCommit {

    return {

      sha:
        data.commitId,

      message:
        data.comment,

      authorName:
        data.author?.name,

      authorEmail:
        data.author?.email,

      authorDate:
        data.author?.date,

      committerName:
        data.committer?.name,

      committerEmail:
        data.committer?.email,

      committerDate:
        data.committer?.date,

      url:
        data.remoteUrl ||
        data.url
    };
  }


  // =======================================================
  // FR-SCM-008 / FR-SCM-010
  // PULL REQUEST NORMALIZATION
  // =======================================================

  static pullRequest(
    data: AzureReposPullRequestData
  ): ScmPullRequest {

    const normalizedStatus =
      data.status
        .toLowerCase();


    return {

      // -----------------------------------------------------
      // Azure uses numeric PR IDs.
      // Common ScmPullRequest.id is a string.
      // -----------------------------------------------------

      id:
        String(
          data.pullRequestId
        ),

      number:
        data.pullRequestId,

      title:
        data.title,

      body:
        data.description ??
        "",


      // -----------------------------------------------------
      // Normalize Azure PR status.
      //
      // active    -> open
      // completed -> closed + merged
      // abandoned -> closed
      // -----------------------------------------------------

      state:
        normalizedStatus ===
        "active"
          ? "open"
          : "closed",


      // -----------------------------------------------------
      // SOURCE BRANCH
      // -----------------------------------------------------

      sourceBranch:
        data.sourceRefName
          .replace(
            /^refs\/heads\//,
            ""
          ),


      // -----------------------------------------------------
      // SOURCE SHA
      // -----------------------------------------------------

      sourceSha:
        data.lastMergeSourceCommit
          ?.commitId ??
        "",


      // -----------------------------------------------------
      // TARGET BRANCH
      // -----------------------------------------------------

      targetBranch:
        data.targetRefName
          .replace(
            /^refs\/heads\//,
            ""
          ),


      // -----------------------------------------------------
      // TARGET SHA
      // -----------------------------------------------------

      targetSha:
        data.lastMergeTargetCommit
          ?.commitId ??
        "",


      // -----------------------------------------------------
      // DRAFT
      // -----------------------------------------------------

      draft:
        data.isDraft ??
        false,


      // -----------------------------------------------------
      // URL
      // -----------------------------------------------------

      url:
        data.repository?.webUrl
          ? `${data.repository.webUrl}/pullrequest/${data.pullRequestId}`
          : data.url ??
            "",


      // -----------------------------------------------------
      // TIMESTAMPS
      // -----------------------------------------------------

      createdAt:
        data.creationDate ??
        "",

      updatedAt:
        data.closedDate ??
        data.creationDate ??
        "",


      // -----------------------------------------------------
      // MERGED
      // -----------------------------------------------------

      merged:
        normalizedStatus ===
        "completed"
    };
  }
}