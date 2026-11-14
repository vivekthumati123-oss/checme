import {
  ScmRepository
} from "../../types/scmRepository";

import {
  GitLabNormalizer,
  GitLabRepositoryData
} from "../../normalization/gitlabNormalizer";

import {
  GitLabErrorMapper
} from "../../errors/gitlabErrorMapper";

import {
  ScmTreeItem
} from "../../types/scmTreeItem";

import {
  ScmRepositoryContent
} from "../../types/scmRepositoryContent";

import {
  ScmBranch
} from "../../types/scmBranch";
import {
  ScmFileOperationResult
} from "../../types/scmFileOperationResult";

import {
  ScmCommit
} from "../../types/scmCommit";

import {
  ScmPullRequest
} from "../../types/scmPullRequest";

import {
  ScmWebhook
} from "../../types/scmWebhook";

import {
  ScmProvider
} from "../../types/scmProvider";


interface GitLabTreeItemData {
  id: string;
  name: string;
  type: "blob" | "tree";
  path: string;
  mode: string;
}


interface GitLabFileData {
  file_name: string;
  file_path: string;

  size: number;

  encoding: string;
  content: string;

  content_sha256?: string;

  ref: string;

  blob_id: string;
  commit_id: string;
  last_commit_id: string;

  execute_filemode?: boolean;
}

interface GitLabBranchData {

  name: string;

  protected: boolean;

  default: boolean;

  merged: boolean;

  web_url: string;

  commit: {
    id: string;
    short_id: string;
    message: string;
    web_url: string;
  };
}

interface GitLabFileOperationData {
  file_path?: string;

  branch?: string;
}

interface GitLabCommitData {

  id:
    string;

  short_id:
    string;

  title:
    string;

  message:
    string;

  author_name:
    string;

  author_email:
    string;

  authored_date:
    string;

  committer_name:
    string;

  committer_email:
    string;

  committed_date:
    string;

  created_at:
    string;

  web_url:
    string;

  parent_ids?:
    string[];
}

interface GitLabMergeRequestData {

  id:
    number;

  iid:
    number;

  title:
    string;

  description?:
    string | null;

  state:
    string;

  source_branch:
    string;

  target_branch:
    string;

  sha?:
    string;

  merge_commit_sha?:
    string | null;

  draft?:
    boolean;

  work_in_progress?:
    boolean;

  web_url:
    string;

  created_at:
    string;

  updated_at:
    string;

  author?: {
    name?:
      string;

    username?:
      string;
  };

  references?: {
    short?:
      string;

    relative?:
      string;

    full?:
      string;
  };
}

interface GitLabWebhookData {

  id:
    number;

  url:
    string;

  created_at?:
    string;

  push_events?:
    boolean;

  tag_push_events?:
    boolean;

  merge_requests_events?:
    boolean;

  issues_events?:
    boolean;

  confidential_issues_events?:
    boolean;

  note_events?:
    boolean;

  confidential_note_events?:
    boolean;

  job_events?:
    boolean;

  pipeline_events?:
    boolean;

  wiki_page_events?:
    boolean;

  deployment_events?:
    boolean;

  releases_events?:
    boolean;

  milestone_events?:
    boolean;

  feature_flag_events?:
    boolean;

  repository_update_events?:
    boolean;

  enable_ssl_verification?:
    boolean;

  alert_status?:
    string;

  disabled_until?:
    string | null;
}
export class GitLabProvider
  implements ScmProvider {

  readonly name =
    "gitlab" as const;
    private normalizeWebhook(
  hook: GitLabWebhookData
): ScmWebhook {

  const events:
    string[] =
      [];


  if (
    hook.push_events
  ) {
    events.push(
      "push"
    );
  }


  if (
    hook.tag_push_events
  ) {
    events.push(
      "tag_push"
    );
  }


  if (
    hook.merge_requests_events
  ) {
    events.push(
      "merge_request"
    );
  }


  if (
    hook.issues_events
  ) {
    events.push(
      "issue"
    );
  }


  if (
    hook.note_events
  ) {
    events.push(
      "note"
    );
  }


  if (
    hook.job_events
  ) {
    events.push(
      "job"
    );
  }


  if (
    hook.pipeline_events
  ) {
    events.push(
      "pipeline"
    );
  }


  if (
    hook.wiki_page_events
  ) {
    events.push(
      "wiki_page"
    );
  }


  if (
    hook.deployment_events
  ) {
    events.push(
      "deployment"
    );
  }


  if (
    hook.releases_events
  ) {
    events.push(
      "release"
    );
  }


  if (
    hook.milestone_events
  ) {
    events.push(
      "milestone"
    );
  }


  if (
    hook.feature_flag_events
  ) {
    events.push(
      "feature_flag"
    );
  }


  if (
    hook.repository_update_events
  ) {
    events.push(
      "repository_update"
    );
  }


  const active =
    !hook.disabled_until;


  return {
    id:
      hook.id.toString(),

    url:
      hook.url,

    active,

    events,

    createdAt:
      hook.created_at
  };
}
    private async normalizeMergeRequest(
  token: string,
  repositoryUrl: string,
  item: GitLabMergeRequestData
): Promise<ScmPullRequest> {

  const sourceBranch =
    await this.getBranch(
      token,
      repositoryUrl,
      item.source_branch
    );


  const targetBranch =
    await this.getBranch(
      token,
      repositoryUrl,
      item.target_branch
    );


  const normalizedState:
    "open" | "closed" =
      item.state === "opened"
        ? "open"
        : "closed";


  return {
    id:
      item.id.toString(),

    number:
      item.iid,

    title:
      item.title,

    body:
      item.description ??
      undefined,

    state:
      normalizedState,

    sourceBranch:
      item.source_branch,

    targetBranch:
      item.target_branch,

    sourceSha:
      sourceBranch.sha,

    targetSha:
      targetBranch.sha,

    author:
      item.author?.name ??
      item.author?.username,

    draft:
      item.draft ??
      item.work_in_progress ??
      false,

    merged:
      item.state ===
      "merged",

    url:
      item.web_url,

    createdAt:
      item.created_at,

    updatedAt:
      item.updated_at
  };
}
private normalizeCommit(
  item: GitLabCommitData
): ScmCommit {

  return {
    sha:
      item.id,

    message:
      item.message,

    authorName:
      item.author_name,

    authorEmail:
      item.author_email,

    authorDate:
      item.authored_date,

    committerName:
      item.committer_name,

    committerEmail:
      item.committer_email,

    committerDate:
      item.committed_date,

    url:
      item.web_url
  };
}
  private readonly baseUrl =
    "https://gitlab.com/api/v4";


  // =======================================================
  // HEADERS
  // =======================================================

  private getHeaders(
    token: string
  ): Record<string, string> {

    if (
      !token ||
      !token.trim()
    ) {

      throw GitLabErrorMapper
        .fromHttpResponse(
          401,
          "GitLab token is required.",
          "authentication"
        );
    }


    return {
      "PRIVATE-TOKEN":
        token,

      "Accept":
        "application/json",

      "Content-Type":
        "application/json"
    };
  }


  // =======================================================
  // PROJECT PATH
  // =======================================================

  private getProjectPath(
    repositoryUrl: string
  ): string {

    let url:
      URL;


    try {

      url =
        new URL(
          repositoryUrl
        );

    } catch {

      throw GitLabErrorMapper
        .fromHttpResponse(
          400,
          `Invalid GitLab repository URL: ${repositoryUrl}`,
          "parseRepositoryUrl"
        );
    }


    if (
      url.hostname.toLowerCase() !==
      "gitlab.com"
    ) {

      throw GitLabErrorMapper
        .fromHttpResponse(
          400,
          "Repository URL is not hosted on GitLab.com.",
          "parseRepositoryUrl"
        );
    }


    const projectPath =
      url.pathname
        .replace(
          /^\/+/,
          ""
        )
        .replace(
          /\/+$/,
          ""
        )
        .replace(
          /\.git$/,
          ""
        );


    if (
      !projectPath ||
      !projectPath.includes("/")
    ) {

      throw GitLabErrorMapper
        .fromHttpResponse(
          400,
          "Invalid GitLab repository path.",
          "parseRepositoryUrl"
        );
    }


    return projectPath;
  }


  // =======================================================
  // PROJECT IDENTIFIER
  // =======================================================

  private getProjectId(
    repositoryUrl: string
  ): string {

    return encodeURIComponent(
      this.getProjectPath(
        repositoryUrl
      )
    );
  }


  // =======================================================
  // FR-SCM-003: LIST REPOSITORIES
  // =======================================================

  async listRepositories(
    token: string,
    _workspace?: string
  ): Promise<ScmRepository[]> {

    const operation =
      "listRepositories";


    try {

      const repositories:
        ScmRepository[] =
          [];


      let page =
        1;


      while (true) {

        const parameters =
          new URLSearchParams({
            membership:
              "true",

            simple:
              "true",

            per_page:
              "100",

            page:
              page.toString()
          });


        const response =
          await fetch(
            `${this.baseUrl}/projects?${parameters.toString()}`,
            {
              method:
                "GET",

              headers:
                this.getHeaders(
                  token
                )
            }
          );


        if (
          !response.ok
        ) {

          const body =
            await response.text();


          throw GitLabErrorMapper
            .fromHttpResponse(
              response.status,
              body ||
                "Failed to list GitLab repositories.",
              operation
            );
        }


        const data =
(await response.json()) as GitLabRepositoryData[];


        for (
          const project of data
        ) {

          repositories.push(
            GitLabNormalizer.repository(
              project
            )
          );
        }


        const nextPage =
          response.headers.get(
            "x-next-page"
          );


        if (
          !nextPage
        ) {
          break;
        }


        const nextPageNumber =
          Number(
            nextPage
          );


        if (
          !Number.isFinite(
            nextPageNumber
          ) ||
          nextPageNumber <= 0
        ) {
          break;
        }


        page =
          nextPageNumber;
      }


      return repositories;

    } catch (error) {

      throw GitLabErrorMapper.map(
        error,
        operation
      );
    }
  }

  async listBranches(
  token: string,
  repositoryUrl: string
): Promise<ScmBranch[]> {

  const operation =
    "listBranches";


  try {

    const projectId =
      this.getProjectId(
        repositoryUrl
      );


    const response =
      await fetch(
        `${this.baseUrl}/projects/${projectId}/repository/branches?per_page=100`,
        {
          method:
            "GET",

          headers:
            this.getHeaders(
              token
            )
        }
      );


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw GitLabErrorMapper
        .fromHttpResponse(
          response.status,
          body ||
            "Failed to list GitLab branches.",
          operation
        );
    }


    const branches =
      (await response.json()) as GitLabBranchData[];


    return branches.map(
      (
        branch
      ): ScmBranch => ({

        name:
          branch.name,

        sha:
          branch.commit.id,

        protected:
          branch.protected
      })
    );

  } catch (error) {

    throw GitLabErrorMapper.map(
      error,
      operation
    );
  }
}

async getBranch(
  token: string,
  repositoryUrl: string,
  branchName: string
): Promise<ScmBranch> {

  const operation =
    "getBranch";


  try {

    const projectId =
      this.getProjectId(
        repositoryUrl
      );


    const encodedBranchName =
      encodeURIComponent(
        branchName
      );


    const response =
      await fetch(
        `${this.baseUrl}/projects/${projectId}/repository/branches/${encodedBranchName}`,
        {
          method:
            "GET",

          headers:
            this.getHeaders(
              token
            )
        }
      );


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw GitLabErrorMapper
        .fromHttpResponse(
          response.status,
          body ||
            "Failed to retrieve GitLab branch.",
          operation
        );
    }


    const branch =
      (await response.json()) as GitLabBranchData;


    return {
      name:
        branch.name,

      sha:
        branch.commit.id,

      protected:
        branch.protected
    };

  } catch (error) {

    throw GitLabErrorMapper.map(
      error,
      operation
    );
  }
}

async createBranch(
  token: string,
  repositoryUrl: string,
  branchName: string,
  fromRef: string
): Promise<ScmBranch> {

  const operation =
    "createBranch";


  try {

    const projectId =
      this.getProjectId(
        repositoryUrl
      );


    const response =
      await fetch(
        `${this.baseUrl}/projects/${projectId}/repository/branches`,
        {
          method:
            "POST",

          headers:
            this.getHeaders(
              token
            ),

          body:
            JSON.stringify({
              branch:
                branchName,

              ref:
                fromRef
            })
        }
      );


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw GitLabErrorMapper
        .fromHttpResponse(
          response.status,
          body ||
            "Failed to create GitLab branch.",
          operation
        );
    }


    const branch =
      (await response.json()) as GitLabBranchData;


    return {
      name:
        branch.name,

      sha:
        branch.commit.id,

      protected:
        branch.protected
    };

  } catch (error) {

    throw GitLabErrorMapper.map(
      error,
      operation
    );
  }
}

async createFile(
  token: string,
  repositoryUrl: string,
  path: string,
  content: string,
  commitMessage: string,
  branch: string
): Promise<ScmFileOperationResult> {

  const operation =
    "createFile";


  try {

    const projectId =
      this.getProjectId(
        repositoryUrl
      );


    const encodedPath =
      encodeURIComponent(
        path
      );


    const response =
      await fetch(
        `${this.baseUrl}/projects/${projectId}/repository/files/${encodedPath}`,
        {
          method:
            "POST",

          headers:
            this.getHeaders(
              token
            ),

          body:
            JSON.stringify({
              branch,
              content,

              commit_message:
                commitMessage,

              encoding:
                "text"
            })
        }
      );


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw GitLabErrorMapper
        .fromHttpResponse(
          response.status,
          body ||
            "Failed to create GitLab repository file.",
          operation
        );
    }


    // Consume the successful response.
    await response.json();


    // Retrieve the committed file so we have its
    // Git blob SHA.
    const files =
      await this.getRepositoryContent(
        token,
        repositoryUrl,
        path,
        branch
      );


    if (
      files.length !== 1
    ) {

      throw new Error(
        `Expected one GitLab file after creation: ${path}`
      );
    }


    const file =
      files[0];


    // The branch now points to the commit created
    // by GitLab's repository file operation.
    const updatedBranch =
      await this.getBranch(
        token,
        repositoryUrl,
        branch
      );


    return {
      path:
        file.path,

      sha:
        file.sha,

      commitSha:
        updatedBranch.sha,

      branch:
        updatedBranch.name
    };

  } catch (error) {

    throw GitLabErrorMapper.map(
      error,
      operation
    );
  }
}

async updateFile(
  token: string,
  repositoryUrl: string,
  path: string,
  content: string,
  commitMessage: string,
  branch: string
): Promise<ScmFileOperationResult> {

  const operation =
    "updateFile";


  try {

    const projectId =
      this.getProjectId(
        repositoryUrl
      );


    const encodedPath =
      encodeURIComponent(
        path
      );


    const response =
      await fetch(
        `${this.baseUrl}/projects/${projectId}/repository/files/${encodedPath}`,
        {
          method:
            "PUT",

          headers:
            this.getHeaders(
              token
            ),

          body:
            JSON.stringify({
              branch,
              content,

              commit_message:
                commitMessage,

              encoding:
                "text"
            })
        }
      );


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw GitLabErrorMapper
        .fromHttpResponse(
          response.status,
          body ||
            "Failed to update GitLab repository file.",
          operation
        );
    }


    await response.json();


    const files =
      await this.getRepositoryContent(
        token,
        repositoryUrl,
        path,
        branch
      );


    if (
      files.length !== 1
    ) {

      throw new Error(
        `Expected one GitLab file after update: ${path}`
      );
    }


    const file =
      files[0];


    const updatedBranch =
      await this.getBranch(
        token,
        repositoryUrl,
        branch
      );


    return {
      path:
        file.path,

      sha:
        file.sha,

      commitSha:
        updatedBranch.sha,

      branch:
        updatedBranch.name
    };

  } catch (error) {

    throw GitLabErrorMapper.map(
      error,
      operation
    );
  }
}
async getRepositoryTree(
  token: string,
  repositoryUrl: string,
  ref?: string
): Promise<ScmTreeItem[]> {

  const operation =
    "getRepositoryTree";


  try {

    const projectId =
      this.getProjectId(
        repositoryUrl
      );


    const repository =
      await this.getRepository(
        token,
        repositoryUrl
      );


    const requestedRef =
      ref ||
      repository.defaultBranch;


    const parameters =
      new URLSearchParams({
        recursive:
          "true",

        per_page:
          "100"
      });


    if (
      requestedRef
    ) {

      parameters.set(
        "ref",
        requestedRef
      );
    }


    const response =
      await fetch(
        `${this.baseUrl}/projects/${projectId}/repository/tree?${parameters.toString()}`,
        {
          method:
            "GET",

          headers:
            this.getHeaders(
              token
            )
        }
      );


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw GitLabErrorMapper
        .fromHttpResponse(
          response.status,
          body ||
            "Failed to retrieve GitLab repository tree.",
          operation
        );
    }


    const data =
  (await response.json()) as GitLabTreeItemData[];


    return data.map(
      (
        item
      ): ScmTreeItem => ({

        path:
          item.path,

        type:
          item.type === "tree"
            ? "directory"
            : "file",

        sha:
          item.id
      })
    );

  } catch (error) {

    throw GitLabErrorMapper.map(
      error,
      operation
    );
  }
}

async listCommits(
  token: string,
  repositoryUrl: string,
  ref?: string
): Promise<ScmCommit[]> {

  const operation =
    "listCommits";


  try {

    const projectId =
      this.getProjectId(
        repositoryUrl
      );


    const parameters =
      new URLSearchParams({
        per_page:
          "100"
      });


    if (
      ref
    ) {

      parameters.set(
        "ref_name",
        ref
      );
    }


    const response =
      await fetch(
        `${this.baseUrl}/projects/${projectId}/repository/commits?${parameters.toString()}`,
        {
          method:
            "GET",

          headers:
            this.getHeaders(
              token
            )
        }
      );


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw GitLabErrorMapper
        .fromHttpResponse(
          response.status,
          body ||
            "Failed to list GitLab commits.",
          operation
        );
    }


    const commits =
      (await response.json()) as GitLabCommitData[];


    return commits.map(
      (
        commit
      ) =>
        this.normalizeCommit(
          commit
        )
    );

  } catch (error) {

    throw GitLabErrorMapper.map(
      error,
      operation
    );
  }
}

async getCommit(
  token: string,
  repositoryUrl: string,
  commitSha: string
): Promise<ScmCommit> {

  const operation =
    "getCommit";


  try {

    const projectId =
      this.getProjectId(
        repositoryUrl
      );


    const encodedCommitSha =
      encodeURIComponent(
        commitSha
      );


    const response =
      await fetch(
        `${this.baseUrl}/projects/${projectId}/repository/commits/${encodedCommitSha}`,
        {
          method:
            "GET",

          headers:
            this.getHeaders(
              token
            )
        }
      );


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw GitLabErrorMapper
        .fromHttpResponse(
          response.status,
          body ||
            "Failed to retrieve GitLab commit.",
          operation
        );
    }


    const commit =
      (await response.json()) as GitLabCommitData;


    return this.normalizeCommit(
      commit
    );

  } catch (error) {

    throw GitLabErrorMapper.map(
      error,
      operation
    );
  }
}

async listPullRequests(
  token: string,
  repositoryUrl: string,
  state:
    "open" |
    "closed" |
    "all" =
      "open"
): Promise<ScmPullRequest[]> {

  const operation =
    "listPullRequests";


  try {

    const projectId =
      this.getProjectId(
        repositoryUrl
      );


    let gitLabState:
      string;


    if (
      state === "open"
    ) {

      gitLabState =
        "opened";

    } else if (
      state === "closed"
    ) {

      gitLabState =
        "closed";

    } else {

      gitLabState =
        "all";
    }


    const parameters =
      new URLSearchParams({
        state:
          gitLabState,

        scope:
          "all",

        per_page:
          "100"
      });


    const response =
      await fetch(
        `${this.baseUrl}/projects/${projectId}/merge_requests?${parameters.toString()}`,
        {
          method:
            "GET",

          headers:
            this.getHeaders(
              token
            )
        }
      );


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw GitLabErrorMapper
        .fromHttpResponse(
          response.status,
          body ||
            "Failed to list GitLab merge requests.",
          operation
        );
    }


    const items =
      (await response.json()) as GitLabMergeRequestData[];


    const results:
      ScmPullRequest[] =
        [];


    for (
      const item of
      items
    ) {

      results.push(
        await this.normalizeMergeRequest(
          token,
          repositoryUrl,
          item
        )
      );
    }


    return results;

  } catch (error) {

    throw GitLabErrorMapper.map(
      error,
      operation
    );
  }
}

async getPullRequest(
  token: string,
  repositoryUrl: string,
  pullRequestNumber: number
): Promise<ScmPullRequest> {

  const operation =
    "getPullRequest";


  try {

    const projectId =
      this.getProjectId(
        repositoryUrl
      );


    const response =
      await fetch(
        `${this.baseUrl}/projects/${projectId}/merge_requests/${pullRequestNumber}`,
        {
          method:
            "GET",

          headers:
            this.getHeaders(
              token
            )
        }
      );


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw GitLabErrorMapper
        .fromHttpResponse(
          response.status,
          body ||
            "Failed to retrieve GitLab merge request.",
          operation
        );
    }


    const item =
      (await response.json()) as GitLabMergeRequestData;


    return this.normalizeMergeRequest(
      token,
      repositoryUrl,
      item
    );

  } catch (error) {

    throw GitLabErrorMapper.map(
      error,
      operation
    );
  }
}

async createPullRequest(
  token: string,
  repositoryUrl: string,
  title: string,
  sourceBranch: string,
  targetBranch: string,
  body?: string
): Promise<ScmPullRequest> {

  const operation =
    "createPullRequest";


  try {

    const projectId =
      this.getProjectId(
        repositoryUrl
      );


    const response =
      await fetch(
        `${this.baseUrl}/projects/${projectId}/merge_requests`,
        {
          method:
            "POST",

          headers:
            this.getHeaders(
              token
            ),

          body:
            JSON.stringify({
              title,

              source_branch:
                sourceBranch,

              target_branch:
                targetBranch,

              description:
                body ?? ""
            })
        }
      );


    if (
      !response.ok
    ) {

      const responseBody =
        await response.text();


      throw GitLabErrorMapper
        .fromHttpResponse(
          response.status,
          responseBody ||
            "Failed to create GitLab merge request.",
          operation
        );
    }


    const item =
      (await response.json()) as GitLabMergeRequestData;


    return this.normalizeMergeRequest(
      token,
      repositoryUrl,
      item
    );

  } catch (error) {

    throw GitLabErrorMapper.map(
      error,
      operation
    );
  }
}

async listWebhooks(
  token: string,
  repositoryUrl: string
): Promise<ScmWebhook[]> {

  const operation =
    "listWebhooks";


  try {

    const projectId =
      this.getProjectId(
        repositoryUrl
      );


    const response =
      await fetch(
        `${this.baseUrl}/projects/${projectId}/hooks`,
        {
          method:
            "GET",

          headers:
            this.getHeaders(
              token
            )
        }
      );


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw GitLabErrorMapper
        .fromHttpResponse(
          response.status,
          body ||
            "Failed to list GitLab project webhooks.",
          operation
        );
    }


    const hooks =
      (await response.json()) as GitLabWebhookData[];


    return hooks.map(
      (
        hook
      ) =>
        this.normalizeWebhook(
          hook
        )
    );

  } catch (error) {

    throw GitLabErrorMapper.map(
      error,
      operation
    );
  }
}
async getRepositoryContent(
  token: string,
  repositoryUrl: string,
  path: string = "",
  ref?: string
): Promise<ScmRepositoryContent[]> {

  const operation =
    "getRepositoryContent";


  try {

    // =====================================================
    // DIRECTORY / ROOT REQUEST
    // =====================================================

    if (
      !path
    ) {

      const tree =
        await this.getRepositoryTree(
          token,
          repositoryUrl,
          ref
        );


      return tree.map(
        (
          item
        ): ScmRepositoryContent => ({

          name:
            item.path
              .split("/")
              .pop() ??
            item.path,

          path:
            item.path,

          type:
            item.type,

          sha:
            item.sha,

          size:
            item.size ?? 0
        })
      );
    }


    // =====================================================
    // FILE REQUEST
    // =====================================================

    const projectId =
      this.getProjectId(
        repositoryUrl
      );


    const repository =
      await this.getRepository(
        token,
        repositoryUrl
      );


    const requestedRef =
      ref ||
      repository.defaultBranch ||
      "HEAD";


    const encodedPath =
      encodeURIComponent(
        path
      );


    const parameters =
      new URLSearchParams({
        ref:
          requestedRef
      });


    const response =
      await fetch(
        `${this.baseUrl}/projects/${projectId}/repository/files/${encodedPath}?${parameters.toString()}`,
        {
          method:
            "GET",

          headers:
            this.getHeaders(
              token
            )
        }
      );


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw GitLabErrorMapper
        .fromHttpResponse(
          response.status,
          body ||
            "Failed to retrieve GitLab repository content.",
          operation
        );
    }


    const file =
  (await response.json()) as GitLabFileData;


    const decodedContent =
      file.encoding === "base64"
        ? Buffer
            .from(
              file.content,
              "base64"
            )
            .toString(
              "utf8"
            )
        : file.content;


    return [
      {
        name:
          file.file_name,

        path:
          file.file_path,

        type:
          "file",

        sha:
          file.blob_id,

        size:
          file.size,

        url:
          `${repositoryUrl}/-/blob/${encodeURIComponent(
            requestedRef
          )}/${file.file_path}`,

        content:
          decodedContent
      }
    ];

  } catch (error) {

    throw GitLabErrorMapper.map(
      error,
      operation
    );
  }
}

  // =======================================================
  // FR-SCM-003: GET REPOSITORY
  // =======================================================

  async getRepository(
    token: string,
    repositoryUrl: string
  ): Promise<ScmRepository> {

    const operation =
      "getRepository";


    try {

      const projectId =
        this.getProjectId(
          repositoryUrl
        );


      const response =
        await fetch(
          `${this.baseUrl}/projects/${projectId}`,
          {
            method:
              "GET",

            headers:
              this.getHeaders(
                token
              )
          }
        );


      if (
        !response.ok
      ) {

        const body =
          await response.text();


        throw GitLabErrorMapper
          .fromHttpResponse(
            response.status,
            body ||
              "Failed to retrieve GitLab repository.",
            operation
          );
      }


      const project =
  (await response.json()) as GitLabRepositoryData;


      return GitLabNormalizer.repository(
        project
      );

    } catch (error) {

      throw GitLabErrorMapper.map(
        error,
        operation
      );
    }
  }
}