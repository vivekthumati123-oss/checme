import { ScmFileOperationResult } from "../../types/scmFileOperationResult";
import { ScmBranch } from "../../types/scmBranch";
import { ScmTreeItem } from "../../types/scmTreeItem";
import { ScmRepositoryContent } from "../../types/scmRepositoryContent";
import { ScmProvider } from "../../types/scmProvider";
import { ScmRepository } from "../../types/scmRepository";
import { ScmCommit } from "../../types/scmCommit";
import { ScmPullRequest } from "../../types/scmPullRequest";
import { ScmWebhook } from "../../types/scmWebhook";

import {
  GitHubNormalizer
} from "../../normalization/githubNormalizer";

import {
  GitHubErrorMapper
} from "../../errors/githubErrorMapper";


interface GitHubRepositoryResponse {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  default_branch: string;
  private: boolean;
}


interface GitHubContentResponse {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: string;
  html_url?: string;
  content?: string;
  encoding?: string;
}


interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
  url: string;
}


interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GitHubTreeEntry[];
  truncated: boolean;
}


interface GitHubBranchResponse {
  name: string;

  commit: {
    sha: string;
    url: string;
  };

  protected: boolean;
}


interface GitHubFileOperationResponse {
  content: {
    path: string;
    sha: string;
  } | null;

  commit: {
    sha: string;
  };
}


interface GitHubCommitResponse {
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


interface GitHubGitCommitResponse {
  sha: string;

  tree: {
    sha: string;
  };

  parents: Array<{
    sha: string;
  }>;
}


interface GitHubCreateCommitResponse {
  sha: string;
}


interface GitHubPullRequestResponse {
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


interface GitHubWebhookResponse {
  id: number;

  active: boolean;

  events: string[];

  config: {
    url?: string;
  };

  created_at?: string;
  updated_at?: string;
}


export class GitHubProvider implements ScmProvider {

  readonly name =
    "github" as const;


  // =========================================================
  // FR-SCM-003: REPOSITORIES
  // =========================================================

  async listRepositories(
    token: string
  ): Promise<ScmRepository[]> {

    const repositories:
      ScmRepository[] = [];


    let url:
      string | null =
        "https://api.github.com/user/repos?per_page=100";


    while (url) {

      let response:
        Response;


      try {

        response =
          await fetch(
            url,
            {
              method:
                "GET",

              headers:
                this.getHeaders(
                  token
                )
            }
          );

      } catch (error) {

        throw GitHubErrorMapper.network(
          "listRepositories",
          error
        );
      }


      if (!response.ok) {

        throw await GitHubErrorMapper.fromResponse(
          response,
          "listRepositories"
        );
      }


      const data =
        (await response.json()) as GitHubRepositoryResponse[];


      repositories.push(
        ...data.map(
          GitHubNormalizer.repository
        )
      );


      url =
        this.getNextPageUrl(
          response.headers.get(
            "link"
          )
        );
    }


    return repositories;
  }


  async getRepository(
    token: string,
    repositoryUrl: string
  ): Promise<ScmRepository> {

    const {
      owner,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const apiUrl =
      `https://api.github.com/repos/${owner}/${repository}`;


    let response:
      Response;


    try {

      response =
        await fetch(
          apiUrl,
          {
            method:
              "GET",

            headers:
              this.getHeaders(
                token
              )
          }
        );

    } catch (error) {

      throw GitHubErrorMapper.network(
        "getRepository",
        error
      );
    }


    if (!response.ok) {

      throw await GitHubErrorMapper.fromResponse(
        response,
        "getRepository"
      );
    }


    const data =
      (await response.json()) as GitHubRepositoryResponse;


    return GitHubNormalizer.repository(
      data
    );
  }


  // =========================================================
  // FR-SCM-004: REPOSITORY CONTENT
  // =========================================================

  async getRepositoryContent(
    token: string,
    repositoryUrl: string,
    path = "",
    ref = "main"
  ): Promise<ScmRepositoryContent[]> {

    const {
      owner,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const encodedPath =
      this.encodeRepositoryPath(
        path
      );


    const parameters =
      new URLSearchParams();


    if (ref) {

      parameters.set(
        "ref",
        ref
      );
    }


    const queryString =
      parameters.toString();


    const apiUrl =
      `https://api.github.com/repos/${owner}/${repository}/contents${
        encodedPath
          ? `/${encodedPath}`
          : ""
      }${
        queryString
          ? `?${queryString}`
          : ""
      }`;


    let response:
      Response;


    try {

      response =
        await fetch(
          apiUrl,
          {
            method:
              "GET",

            headers:
              this.getHeaders(
                token
              )
          }
        );

    } catch (error) {

      throw GitHubErrorMapper.network(
        "getRepositoryContent",
        error
      );
    }


    if (!response.ok) {

      throw await GitHubErrorMapper.fromResponse(
        response,
        "getRepositoryContent"
      );
    }


    const data =
      await response.json();


    if (Array.isArray(data)) {

      return (
        data as GitHubContentResponse[]
      ).map(
        (
          item
        ): ScmRepositoryContent => ({

          name:
            item.name,

          path:
            item.path,

          sha:
            item.sha,

          size:
            item.size,

          type:
            item.type === "dir"
              ? "directory"
              : "file",

          url:
            item.html_url
        })
      );
    }


    const item =
      data as GitHubContentResponse;


    let content:
      string | undefined;


    if (
      item.type === "file" &&
      item.content
    ) {

      const normalizedBase64 =
        item.content.replace(
          /\s/g,
          ""
        );


      content =
        Buffer
          .from(
            normalizedBase64,
            "base64"
          )
          .toString(
            "utf8"
          );
    }


    return [
      {
        name:
          item.name,

        path:
          item.path,

        sha:
          item.sha,

        size:
          item.size,

        type:
          item.type === "dir"
            ? "directory"
            : "file",

        url:
          item.html_url,

        content
      }
    ];
  }


  async getRepositoryTree(
    token: string,
    repositoryUrl: string,
    ref = "main"
  ): Promise<ScmTreeItem[]> {

    const {
      owner,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const encodedRef =
      encodeURIComponent(
        ref
      );


    const apiUrl =
      `https://api.github.com/repos/${owner}/${repository}/git/trees/${encodedRef}?recursive=1`;


    let response:
      Response;


    try {

      response =
        await fetch(
          apiUrl,
          {
            method:
              "GET",

            headers:
              this.getHeaders(
                token
              )
          }
        );

    } catch (error) {

      throw GitHubErrorMapper.network(
        "getRepositoryTree",
        error
      );
    }


    if (!response.ok) {

      throw await GitHubErrorMapper.fromResponse(
        response,
        "getRepositoryTree"
      );
    }


    const data =
      (await response.json()) as GitHubTreeResponse;


    if (data.truncated) {

      console.warn(
        "Warning: GitHub returned a truncated repository tree."
      );
    }


    return data.tree
      .filter(
        (
          item
        ) =>
          item.type === "blob" ||
          item.type === "tree"
      )
      .map(
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
            item.sha,

          size:
            item.size
        })
      );
  }


  // =========================================================
  // FR-SCM-005: BRANCH MANAGEMENT
  // =========================================================

  async listBranches(
    token: string,
    repositoryUrl: string
  ): Promise<ScmBranch[]> {

    const {
      owner,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const branches:
      ScmBranch[] = [];


    let page =
      1;


    while (true) {

      const apiUrl =
        `https://api.github.com/repos/${owner}/${repository}/branches?per_page=100&page=${page}`;


      let response:
        Response;


      try {

        response =
          await fetch(
            apiUrl,
            {
              method:
                "GET",

              headers:
                this.getHeaders(
                  token
                )
            }
          );

      } catch (error) {

        throw GitHubErrorMapper.network(
          "listBranches",
          error
        );
      }


      if (!response.ok) {

        throw await GitHubErrorMapper.fromResponse(
          response,
          "listBranches"
        );
      }


      const data =
        (await response.json()) as GitHubBranchResponse[];


      branches.push(
        ...data.map(
          GitHubNormalizer.branch
        )
      );


      if (
        data.length < 100
      ) {

        break;
      }


      page++;
    }


    return branches;
  }


  async getBranch(
    token: string,
    repositoryUrl: string,
    branchName: string
  ): Promise<ScmBranch> {

    if (!branchName.trim()) {

      throw new Error(
        "Branch name is required."
      );
    }


    const {
      owner,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const encodedBranch =
      encodeURIComponent(
        branchName
      );


    const apiUrl =
      `https://api.github.com/repos/${owner}/${repository}/branches/${encodedBranch}`;


    let response:
      Response;


    try {

      response =
        await fetch(
          apiUrl,
          {
            method:
              "GET",

            headers:
              this.getHeaders(
                token
              )
          }
        );

    } catch (error) {

      throw GitHubErrorMapper.network(
        "getBranch",
        error
      );
    }


    if (!response.ok) {

      throw await GitHubErrorMapper.fromResponse(
        response,
        "getBranch"
      );
    }


    const branch =
      (await response.json()) as GitHubBranchResponse;


    return GitHubNormalizer.branch(
      branch
    );
  }


  async createBranch(
    token: string,
    repositoryUrl: string,
    branchName: string,
    fromRef: string
  ): Promise<ScmBranch> {

    if (!branchName.trim()) {

      throw new Error(
        "New branch name is required."
      );
    }


    if (!fromRef.trim()) {

      throw new Error(
        "Source branch is required."
      );
    }


    const {
      owner,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const sourceBranch =
      await this.getBranch(
        token,
        repositoryUrl,
        fromRef
      );


    const apiUrl =
      `https://api.github.com/repos/${owner}/${repository}/git/refs`;


    let response:
      Response;


    try {

      response =
        await fetch(
          apiUrl,
          {
            method:
              "POST",

            headers:
              this.getHeaders(
                token,
                true
              ),

            body:
              JSON.stringify({
                ref:
                  `refs/heads/${branchName}`,

                sha:
                  sourceBranch.sha
              })
          }
        );

    } catch (error) {

      throw GitHubErrorMapper.network(
        "createBranch",
        error
      );
    }


    if (!response.ok) {

      throw await GitHubErrorMapper.fromResponse(
        response,
        "createBranch"
      );
    }


    return this.getBranch(
      token,
      repositoryUrl,
      branchName
    );
  }


  // =========================================================
  // FR-SCM-006: FILE MANAGEMENT
  // =========================================================

  async createFile(
    token: string,
    repositoryUrl: string,
    path: string,
    content: string,
    commitMessage: string,
    branch: string
  ): Promise<ScmFileOperationResult> {

    if (!path.trim()) {

      throw new Error(
        "File path is required."
      );
    }


    if (!commitMessage.trim()) {

      throw new Error(
        "Commit message is required."
      );
    }


    if (!branch.trim()) {

      throw new Error(
        "Branch is required."
      );
    }


    const {
      owner,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const encodedPath =
      this.encodeRepositoryPath(
        path
      );


    if (!encodedPath) {

      throw new Error(
        "A valid file path is required."
      );
    }


    const apiUrl =
      `https://api.github.com/repos/${owner}/${repository}/contents/${encodedPath}`;


    const encodedContent =
      Buffer
        .from(
          content,
          "utf8"
        )
        .toString(
          "base64"
        );


    let response:
      Response;


    try {

      response =
        await fetch(
          apiUrl,
          {
            method:
              "PUT",

            headers:
              this.getHeaders(
                token,
                true
              ),

            body:
              JSON.stringify({
                message:
                  commitMessage,

                content:
                  encodedContent,

                branch
              })
          }
        );

    } catch (error) {

      throw GitHubErrorMapper.network(
        "createFile",
        error
      );
    }


    if (!response.ok) {

      throw await GitHubErrorMapper.fromResponse(
        response,
        "createFile"
      );
    }


    const data =
      (await response.json()) as GitHubFileOperationResponse;


    if (!data.content) {

      throw new Error(
        "GitHub created the commit but did not return file metadata."
      );
    }


    return {
      path:
        data.content.path,

      sha:
        data.content.sha,

      commitSha:
        data.commit.sha,

      branch
    };
  }


  async updateFile(
    token: string,
    repositoryUrl: string,
    path: string,
    content: string,
    commitMessage: string,
    branch: string
  ): Promise<ScmFileOperationResult> {

    if (!path.trim()) {

      throw new Error(
        "File path is required."
      );
    }


    if (!commitMessage.trim()) {

      throw new Error(
        "Commit message is required."
      );
    }


    if (!branch.trim()) {

      throw new Error(
        "Branch is required."
      );
    }


    const existingContent =
      await this.getRepositoryContent(
        token,
        repositoryUrl,
        path,
        branch
      );


    if (
      existingContent.length !== 1 ||
      existingContent[0].type !== "file"
    ) {

      throw new Error(
        `File not found: ${path}`
      );
    }


    const existingFile =
      existingContent[0];


    const {
      owner,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const encodedPath =
      this.encodeRepositoryPath(
        path
      );


    const apiUrl =
      `https://api.github.com/repos/${owner}/${repository}/contents/${encodedPath}`;


    const encodedContent =
      Buffer
        .from(
          content,
          "utf8"
        )
        .toString(
          "base64"
        );


    let response:
      Response;


    try {

      response =
        await fetch(
          apiUrl,
          {
            method:
              "PUT",

            headers:
              this.getHeaders(
                token,
                true
              ),

            body:
              JSON.stringify({
                message:
                  commitMessage,

                content:
                  encodedContent,

                sha:
                  existingFile.sha,

                branch
              })
          }
        );

    } catch (error) {

      throw GitHubErrorMapper.network(
        "updateFile",
        error
      );
    }


    if (!response.ok) {

      throw await GitHubErrorMapper.fromResponse(
        response,
        "updateFile"
      );
    }


    const data =
      (await response.json()) as GitHubFileOperationResponse;


    if (!data.content) {

      throw new Error(
        "GitHub updated the commit but did not return file metadata."
      );
    }


    return {
      path:
        data.content.path,

      sha:
        data.content.sha,

      commitSha:
        data.commit.sha,

      branch
    };
  }


  // =========================================================
  // FR-SCM-007: COMMIT MANAGEMENT
  // =========================================================

  async listCommits(
    token: string,
    repositoryUrl: string,
    ref?: string
  ): Promise<ScmCommit[]> {

    const {
      owner,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const commits:
      ScmCommit[] = [];


    let page =
      1;


    while (true) {

      const parameters =
        new URLSearchParams({
          per_page:
            "100",

          page:
            page.toString()
        });


      if (ref) {

        parameters.set(
          "sha",
          ref
        );
      }


      const apiUrl =
        `https://api.github.com/repos/${owner}/${repository}/commits?${parameters.toString()}`;


      let response:
        Response;


      try {

        response =
          await fetch(
            apiUrl,
            {
              method:
                "GET",

              headers:
                this.getHeaders(
                  token
                )
            }
          );

      } catch (error) {

        throw GitHubErrorMapper.network(
          "listCommits",
          error
        );
      }


      if (!response.ok) {

        throw await GitHubErrorMapper.fromResponse(
          response,
          "listCommits"
        );
      }


      const data =
        (await response.json()) as GitHubCommitResponse[];


      commits.push(
        ...data.map(
          GitHubNormalizer.commit
        )
      );


      if (
        data.length < 100
      ) {

        break;
      }


      page++;
    }


    return commits;
  }


  async getCommit(
    token: string,
    repositoryUrl: string,
    commitSha: string
  ): Promise<ScmCommit> {

    if (!commitSha.trim()) {

      throw new Error(
        "Commit SHA is required."
      );
    }


    const {
      owner,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const encodedCommitSha =
      encodeURIComponent(
        commitSha
      );


    const apiUrl =
      `https://api.github.com/repos/${owner}/${repository}/commits/${encodedCommitSha}`;


    let response:
      Response;


    try {

      response =
        await fetch(
          apiUrl,
          {
            method:
              "GET",

            headers:
              this.getHeaders(
                token
              )
          }
        );

    } catch (error) {

      throw GitHubErrorMapper.network(
        "getCommit",
        error
      );
    }


    if (!response.ok) {

      throw await GitHubErrorMapper.fromResponse(
        response,
        "getCommit"
      );
    }


    const item =
      (await response.json()) as GitHubCommitResponse;


    return GitHubNormalizer.commit(
      item
    );
  }


  async createCommit(
    token: string,
    repositoryUrl: string,
    branch: string,
    message: string
  ): Promise<ScmCommit> {

    if (!branch.trim()) {

      throw new Error(
        "Branch is required."
      );
    }


    if (!message.trim()) {

      throw new Error(
        "Commit message is required."
      );
    }


    const {
      owner,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const currentBranch =
      await this.getBranch(
        token,
        repositoryUrl,
        branch
      );


    const parentSha =
      currentBranch.sha;


    const commitObjectUrl =
      `https://api.github.com/repos/${owner}/${repository}/git/commits/${encodeURIComponent(parentSha)}`;


    let commitObjectResponse:
      Response;


    try {

      commitObjectResponse =
        await fetch(
          commitObjectUrl,
          {
            method:
              "GET",

            headers:
              this.getHeaders(
                token
              )
          }
        );

    } catch (error) {

      throw GitHubErrorMapper.network(
        "createCommit.getParent",
        error
      );
    }


    if (!commitObjectResponse.ok) {

      throw await GitHubErrorMapper.fromResponse(
        commitObjectResponse,
        "createCommit.getParent"
      );
    }


    const currentCommit =
      (await commitObjectResponse.json()) as GitHubGitCommitResponse;


    const createCommitUrl =
      `https://api.github.com/repos/${owner}/${repository}/git/commits`;


    let createCommitResponse:
      Response;


    try {

      createCommitResponse =
        await fetch(
          createCommitUrl,
          {
            method:
              "POST",

            headers:
              this.getHeaders(
                token,
                true
              ),

            body:
              JSON.stringify({
                message,

                tree:
                  currentCommit.tree.sha,

                parents: [
                  parentSha
                ]
              })
          }
        );

    } catch (error) {

      throw GitHubErrorMapper.network(
        "createCommit.create",
        error
      );
    }


    if (!createCommitResponse.ok) {

      throw await GitHubErrorMapper.fromResponse(
        createCommitResponse,
        "createCommit.create"
      );
    }


    const newCommit =
      (await createCommitResponse.json()) as GitHubCreateCommitResponse;


    const encodedBranch =
      branch
        .split("/")
        .map(
          encodeURIComponent
        )
        .join("/");


    const updateReferenceUrl =
      `https://api.github.com/repos/${owner}/${repository}/git/refs/heads/${encodedBranch}`;


    let updateReferenceResponse:
      Response;


    try {

      updateReferenceResponse =
        await fetch(
          updateReferenceUrl,
          {
            method:
              "PATCH",

            headers:
              this.getHeaders(
                token,
                true
              ),

            body:
              JSON.stringify({
                sha:
                  newCommit.sha,

                force:
                  false
              })
          }
        );

    } catch (error) {

      throw GitHubErrorMapper.network(
        "createCommit.updateReference",
        error
      );
    }


    if (!updateReferenceResponse.ok) {

      throw await GitHubErrorMapper.fromResponse(
        updateReferenceResponse,
        "createCommit.updateReference"
      );
    }


    return this.getCommit(
      token,
      repositoryUrl,
      newCommit.sha
    );
  }


  // =========================================================
  // FR-SCM-008: PULL REQUEST MANAGEMENT
  // =========================================================

  async listPullRequests(
    token: string,
    repositoryUrl: string,
    state: "open" | "closed" | "all" = "open"
  ): Promise<ScmPullRequest[]> {

    const {
      owner,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const pullRequests:
      ScmPullRequest[] = [];


    let page =
      1;


    while (true) {

      const parameters =
        new URLSearchParams({
          state,

          per_page:
            "100",

          page:
            page.toString()
        });


      const apiUrl =
        `https://api.github.com/repos/${owner}/${repository}/pulls?${parameters.toString()}`;


      let response:
        Response;


      try {

        response =
          await fetch(
            apiUrl,
            {
              method:
                "GET",

              headers:
                this.getHeaders(
                  token
                )
            }
          );

      } catch (error) {

        throw GitHubErrorMapper.network(
          "listPullRequests",
          error
        );
      }


      if (!response.ok) {

        throw await GitHubErrorMapper.fromResponse(
          response,
          "listPullRequests"
        );
      }


      const data =
        (await response.json()) as GitHubPullRequestResponse[];


      pullRequests.push(
        ...data.map(
          GitHubNormalizer.pullRequest
        )
      );


      if (
        data.length < 100
      ) {

        break;
      }


      page++;
    }


    return pullRequests;
  }


  async getPullRequest(
    token: string,
    repositoryUrl: string,
    pullRequestNumber: number
  ): Promise<ScmPullRequest> {

    if (
      !Number.isInteger(
        pullRequestNumber
      ) ||
      pullRequestNumber <= 0
    ) {

      throw new Error(
        "A valid Pull Request number is required."
      );
    }


    const {
      owner,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const apiUrl =
      `https://api.github.com/repos/${owner}/${repository}/pulls/${pullRequestNumber}`;


    let response:
      Response;


    try {

      response =
        await fetch(
          apiUrl,
          {
            method:
              "GET",

            headers:
              this.getHeaders(
                token
              )
          }
        );

    } catch (error) {

      throw GitHubErrorMapper.network(
        "getPullRequest",
        error
      );
    }


    if (!response.ok) {

      throw await GitHubErrorMapper.fromResponse(
        response,
        "getPullRequest"
      );
    }


    const item =
      (await response.json()) as GitHubPullRequestResponse;


    return GitHubNormalizer.pullRequest(
      item
    );
  }


  async createPullRequest(
    token: string,
    repositoryUrl: string,
    title: string,
    sourceBranch: string,
    targetBranch: string,
    body?: string
  ): Promise<ScmPullRequest> {

    if (!title.trim()) {

      throw new Error(
        "Pull Request title is required."
      );
    }


    if (!sourceBranch.trim()) {

      throw new Error(
        "Source branch is required."
      );
    }


    if (!targetBranch.trim()) {

      throw new Error(
        "Target branch is required."
      );
    }


    if (
      sourceBranch ===
      targetBranch
    ) {

      throw new Error(
        "Source and target branches must be different."
      );
    }


    const {
      owner,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const apiUrl =
      `https://api.github.com/repos/${owner}/${repository}/pulls`;


    let response:
      Response;


    try {

      response =
        await fetch(
          apiUrl,
          {
            method:
              "POST",

            headers:
              this.getHeaders(
                token,
                true
              ),

            body:
              JSON.stringify({
                title,

                head:
                  sourceBranch,

                base:
                  targetBranch,

                body
              })
          }
        );

    } catch (error) {

      throw GitHubErrorMapper.network(
        "createPullRequest",
        error
      );
    }


    if (!response.ok) {

      throw await GitHubErrorMapper.fromResponse(
        response,
        "createPullRequest"
      );
    }


    const item =
      (await response.json()) as GitHubPullRequestResponse;


    return GitHubNormalizer.pullRequest(
      item
    );
  }


  // =========================================================
  // FR-SCM-009: WEBHOOKS
  // =========================================================

  async listWebhooks(
    token: string,
    repositoryUrl: string
  ): Promise<ScmWebhook[]> {

    const {
      owner,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const webhooks:
      ScmWebhook[] = [];


    let page =
      1;


    while (true) {

      const apiUrl =
        `https://api.github.com/repos/${owner}/${repository}/hooks?per_page=100&page=${page}`;


      let response:
        Response;


      try {

        response =
          await fetch(
            apiUrl,
            {
              method:
                "GET",

              headers:
                this.getHeaders(
                  token
                )
            }
          );

      } catch (error) {

        throw GitHubErrorMapper.network(
          "listWebhooks",
          error
        );
      }


      if (!response.ok) {

        throw await GitHubErrorMapper.fromResponse(
          response,
          "listWebhooks"
        );
      }


      const data =
        (await response.json()) as GitHubWebhookResponse[];


      webhooks.push(
        ...data.map(
          GitHubNormalizer.webhook
        )
      );


      if (
        data.length < 100
      ) {

        break;
      }


      page++;
    }


    return webhooks;
  }


  // =========================================================
  // PRIVATE HELPERS
  // =========================================================

  private parseRepositoryUrl(
    repositoryUrl: string
  ): {
    owner: string;
    repository: string;
  } {

    let parsedUrl:
      URL;


    try {

      parsedUrl =
        new URL(
          repositoryUrl
        );

    } catch {

      throw new Error(
        `Invalid GitHub repository URL: ${repositoryUrl}`
      );
    }


    if (
      parsedUrl.hostname.toLowerCase() !==
      "github.com"
    ) {

      throw new Error(
        `Invalid GitHub repository URL: ${repositoryUrl}`
      );
    }


    const parts =
      parsedUrl.pathname
        .replace(
          /^\/|\/$/g,
          ""
        )
        .split("/")
        .filter(Boolean);


    if (
      parts.length < 2
    ) {

      throw new Error(
        `Invalid GitHub repository URL: ${repositoryUrl}`
      );
    }


    const owner =
      encodeURIComponent(
        parts[0]
      );


    const repository =
      encodeURIComponent(
        parts[1].replace(
          /\.git$/,
          ""
        )
      );


    return {
      owner,
      repository
    };
  }


  private encodeRepositoryPath(
    path: string
  ): string {

    return path
      .split("/")
      .filter(Boolean)
      .map(
        encodeURIComponent
      )
      .join("/");
  }


  private getHeaders(
    token: string,
    includeContentType = false
  ): Record<string, string> {

    const headers:
      Record<string, string> = {

        Authorization:
          `Bearer ${token}`,

        Accept:
          "application/vnd.github+json"
      };


    if (includeContentType) {

      headers["Content-Type"] =
        "application/json";
    }


    return headers;
  }


  private getNextPageUrl(
    linkHeader: string | null
  ): string | null {

    if (!linkHeader) {

      return null;
    }


    const links =
      linkHeader.split(",");


    for (const link of links) {

      const match =
        link.match(
          /<([^>]+)>;\s*rel="next"/
        );


      if (
        match &&
        match[1]
      ) {

        return match[1];
      }
    }


    return null;
  }
}