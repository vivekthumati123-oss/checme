import {
  ScmRepository
} from "../../types/scmRepository";

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
  BitbucketErrorMapper
} from "../../errors/bitbucketErrorMapper";
import {
  ScmTreeItem
} from "../../types/scmTreeItem";
import {
  ScmProvider
} from "../../types/scmProvider";

import {
  BitbucketNormalizer,
  BitbucketRepositoryData,
  BitbucketBranchData,
  BitbucketCommitData,
  BitbucketPullRequestData,
  BitbucketWebhookData
} from "../../normalization/bitbucketNormalizer";


interface BitbucketSourceEntry {
  path: string;
  type: string;

  commit?: {
    hash: string;
  };

  size?: number;

  links?: {
    self?: {
      href: string;
    };
  };
}


interface BitbucketSourceDirectoryResponse {
  values: BitbucketSourceEntry[];
  next?: string;
}


interface BitbucketBranchesResponse {
  values: BitbucketBranchData[];
  next?: string;
}


interface BitbucketCommitsResponse {
  values: BitbucketCommitData[];
  next?: string;
}


interface BitbucketPullRequestsResponse {
  values: BitbucketPullRequestData[];
  next?: string;
}

interface BitbucketWebhooksResponse {
  values: BitbucketWebhookData[];
  next?: string;
}

export class BitbucketProvider
  implements ScmProvider {

  readonly name = "bitbucket" as const;

async listRepositories(
  token: string,
  workspace?: string
): Promise<ScmRepository[]> {

  const operation =
    "listRepositories";


  try {

    if (!workspace?.trim()) {

      throw BitbucketErrorMapper.fromHttpResponse(
        400,
        "Bitbucket workspace is required.",
        operation
      );
    }


    const repositories:
      ScmRepository[] = [];


    const encodedWorkspace =
      encodeURIComponent(
        workspace
      );


    let nextUrl:
      string | undefined =
        `https://api.bitbucket.org/2.0/repositories/${encodedWorkspace}?role=member&pagelen=100`;


    while (nextUrl) {

      const response =
        await fetch(
          nextUrl,
          {
            method:
              "GET",

            headers:
              this.getHeaders(
                token
              )
          }
        );


      if (!response.ok) {

        const errorBody =
          await response.text();


        throw BitbucketErrorMapper.fromHttpResponse(
          response.status,
          errorBody ||
            "Failed to list Bitbucket repositories.",
          operation
        );
      }


      const data =
        (await response.json()) as {
          values: BitbucketRepositoryData[];
          next?: string;
        };


      repositories.push(
        ...data.values.map(
          BitbucketNormalizer.repository
        )
      );


      nextUrl =
        data.next;
    }


    return repositories;

  } catch (error) {

    throw BitbucketErrorMapper.map(
      error,
      operation
    );
  }
}
  // =========================================================
  // FR-SCM-003: REPOSITORY
  // =========================================================

  async getRepository(
    token: string,
    repositoryUrl: string
  ): Promise<ScmRepository> {

    const {
      workspace,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );

    const apiUrl =
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repository}`;

    const response =
      await fetch(apiUrl, {
        method: "GET",
        headers: this.getHeaders(token)
      });

    if (!response.ok) {

      const body =
        await response.text();

      throw new Error(
        `Failed to fetch Bitbucket repository. Status: ${response.status}. ${body}`
      );
    }

    const data =
      (await response.json()) as BitbucketRepositoryData;

    return BitbucketNormalizer.repository(
      data
    );
  }

async getRepositoryTree(
  token: string,
  repositoryUrl: string,
  ref = "Main"
): Promise<ScmTreeItem[]> {

  const operation =
    "getRepositoryTree";


  try {

    if (!ref.trim()) {

      throw BitbucketErrorMapper.fromHttpResponse(
        400,
        "Repository ref is required.",
        operation
      );
    }


    const tree:
      ScmTreeItem[] = [];


    /*
     * Recursively walk each Bitbucket directory.
     */
    const walk =
      async (
        path: string
      ): Promise<void> => {

        const items =
          await this.getRepositoryContent(
            token,
            repositoryUrl,
            path,
            ref
          );


        for (const item of items) {

          const treeItem:
            ScmTreeItem = {

              path:
                item.path,

              type:
                item.type,

              sha:
                item.sha,

              size:
                item.size
            };


          tree.push(
            treeItem
          );


          if (
            item.type === "directory"
          ) {

            await walk(
              item.path
            );
          }
        }
      };


    await walk(
      ""
    );


    return tree;

  } catch (error) {

    throw BitbucketErrorMapper.map(
      error,
      operation
    );
  }
}
  // =========================================================
  // FR-SCM-004: REPOSITORY CONTENT
  // =========================================================

  async getRepositoryContent(
    token: string,
    repositoryUrl: string,
    path = "",
    ref = "Main"
  ): Promise<ScmRepositoryContent[]> {

    const {
      workspace,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );

    const encodedRef =
      encodeURIComponent(
        ref
      );

    const encodedPath =
      this.encodeRepositoryPath(
        path
      );

    let apiUrl =
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repository}/src/${encodedRef}/`;

    if (encodedPath) {
      apiUrl += encodedPath;
    }

    const response =
      await fetch(apiUrl, {
        method: "GET",
        headers: this.getHeaders(token)
      });

    if (!response.ok) {

      const errorBody =
        await response.text();

      throw new Error(
        `Failed to fetch Bitbucket repository content. Status: ${response.status}. ${errorBody}`
      );
    }

    const contentType =
      response.headers.get(
        "content-type"
      ) ?? "";


    /*
     * Directory response.
     */
    if (
      contentType.includes(
        "application/json"
      )
    ) {

      const data =
        (await response.json()) as BitbucketSourceDirectoryResponse;

      return data.values.map(
        (
          item
        ): ScmRepositoryContent => {

          const name =
            item.path
              .split("/")
              .filter(Boolean)
              .pop() ??
            item.path;

          return {
            name,

            path:
              item.path,

            sha:
              item.commit?.hash ?? "",

            size:
              item.size ?? 0,

            type:
              item.type === "commit_directory"
                ? "directory"
                : "file",

            url:
              item.links?.self?.href
          };
        }
      );
    }


    /*
     * Individual file response.
     */
    const content =
      await response.text();

    const fileName =
      path
        .split("/")
        .filter(Boolean)
        .pop() ??
      path;

    return [
      {
        name:
          fileName,

        path,

        sha:
          "",

        size:
          Buffer.byteLength(
            content,
            "utf8"
          ),

        type:
          "file",

        content
      }
    ];
  }


  // =========================================================
  // FR-SCM-005: BRANCH MANAGEMENT
  // =========================================================

  async listBranches(
    token: string,
    repositoryUrl: string
  ): Promise<ScmBranch[]> {

    const {
      workspace,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );

    const branches:
      ScmBranch[] = [];

    let apiUrl:
      string | undefined =
        `https://api.bitbucket.org/2.0/repositories/${workspace}/${repository}/refs/branches?pagelen=100`;


    while (apiUrl) {

      const response =
        await fetch(apiUrl, {
          method: "GET",
          headers: this.getHeaders(token)
        });


      if (!response.ok) {

        const errorBody =
          await response.text();

        throw new Error(
          `Failed to fetch Bitbucket branches. Status: ${response.status}. ${errorBody}`
        );
      }


      const data =
        (await response.json()) as BitbucketBranchesResponse;


      branches.push(
        ...data.values.map(
          BitbucketNormalizer.branch
        )
      );


      apiUrl =
        data.next;
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
      workspace,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const encodedBranch =
      encodeURIComponent(
        branchName
      );


    const apiUrl =
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repository}/refs/branches/${encodedBranch}`;


    const response =
      await fetch(apiUrl, {
        method: "GET",
        headers: this.getHeaders(token)
      });


    if (!response.ok) {

      const errorBody =
        await response.text();

      throw new Error(
        `Failed to fetch Bitbucket branch '${branchName}'. Status: ${response.status}. ${errorBody}`
      );
    }


    const data =
      (await response.json()) as BitbucketBranchData;


    return BitbucketNormalizer.branch(
      data
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
      workspace,
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
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repository}/refs/branches`;


    const response =
      await fetch(apiUrl, {
        method: "POST",

        headers: {
          ...this.getHeaders(token),

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            name:
              branchName,

            target: {
              hash:
                sourceBranch.sha
            }
          })
      });


    if (!response.ok) {

      const errorBody =
        await response.text();

      throw new Error(
        `Failed to create Bitbucket branch '${branchName}'. Status: ${response.status}. ${errorBody}`
      );
    }


    const data =
      (await response.json()) as BitbucketBranchData;


    return BitbucketNormalizer.branch(
      data
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


    const normalizedPath =
      this.normalizeRepositoryPath(
        path
      );


    if (!normalizedPath) {

      throw new Error(
        "A valid file path is required."
      );
    }


    const {
      workspace,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const branchBefore =
      await this.getBranch(
        token,
        repositoryUrl,
        branch
      );


    const apiUrl =
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repository}/src`;


    const form =
      new URLSearchParams();


    form.set(
      `/${normalizedPath}`,
      content
    );


    form.set(
      "message",
      commitMessage
    );


    form.set(
      "branch",
      branch
    );


    const response =
      await fetch(apiUrl, {
        method: "POST",

        headers: {
          ...this.getHeaders(token),

          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          form.toString()
      });


    if (!response.ok) {

      const errorBody =
        await response.text();

      throw new Error(
        `Failed to create Bitbucket file '${normalizedPath}'. Status: ${response.status}. ${errorBody}`
      );
    }


    const branchAfter =
      await this.getBranch(
        token,
        repositoryUrl,
        branch
      );


    if (
      branchAfter.sha ===
      branchBefore.sha
    ) {

      throw new Error(
        "Bitbucket accepted the file request but the branch HEAD did not change."
      );
    }


    const fileItems =
      await this.getRepositoryContent(
        token,
        repositoryUrl,
        normalizedPath,
        branchAfter.sha
      );


    const file =
      fileItems[0];


    if (!file) {

      throw new Error(
        "Bitbucket created the commit but the file could not be retrieved."
      );
    }


    return {
      path:
        normalizedPath,

      sha:
        file.sha ||
        branchAfter.sha,

      commitSha:
        branchAfter.sha,

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


    const normalizedPath =
      this.normalizeRepositoryPath(
        path
      );


    if (!normalizedPath) {

      throw new Error(
        "A valid file path is required."
      );
    }


    const existingContent =
      await this.getRepositoryContent(
        token,
        repositoryUrl,
        normalizedPath,
        branch
      );


    if (
      existingContent.length !== 1 ||
      existingContent[0].type !== "file"
    ) {

      throw new Error(
        `File not found: ${normalizedPath}`
      );
    }


    const {
      workspace,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const branchBefore =
      await this.getBranch(
        token,
        repositoryUrl,
        branch
      );


    const apiUrl =
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repository}/src`;


    const form =
      new URLSearchParams();


    form.set(
      `/${normalizedPath}`,
      content
    );


    form.set(
      "message",
      commitMessage
    );


    form.set(
      "branch",
      branch
    );


    const response =
      await fetch(apiUrl, {
        method: "POST",

        headers: {
          ...this.getHeaders(token),

          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          form.toString()
      });


    if (!response.ok) {

      const errorBody =
        await response.text();

      throw new Error(
        `Failed to update Bitbucket file '${normalizedPath}'. Status: ${response.status}. ${errorBody}`
      );
    }


    const branchAfter =
      await this.getBranch(
        token,
        repositoryUrl,
        branch
      );


    if (
      branchAfter.sha ===
      branchBefore.sha
    ) {

      throw new Error(
        "Bitbucket accepted the file update but the branch HEAD did not change."
      );
    }


    const updatedContent =
      await this.getRepositoryContent(
        token,
        repositoryUrl,
        normalizedPath,
        branchAfter.sha
      );


    const updatedFile =
      updatedContent[0];


    if (!updatedFile) {

      throw new Error(
        "Bitbucket updated the commit but the file could not be retrieved."
      );
    }


    return {
      path:
        normalizedPath,

      sha:
        updatedFile.sha ||
        branchAfter.sha,

      commitSha:
        branchAfter.sha,

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
      workspace,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const commits:
      ScmCommit[] = [];


    const encodedRef =
      ref
        ? `/${encodeURIComponent(ref)}`
        : "";


    let apiUrl:
      string | undefined =
        `https://api.bitbucket.org/2.0/repositories/${workspace}/${repository}/commits${encodedRef}?pagelen=100`;


    while (apiUrl) {

      const response =
        await fetch(apiUrl, {
          method: "GET",
          headers: this.getHeaders(token)
        });


      if (!response.ok) {

        const errorBody =
          await response.text();

        throw new Error(
          `Failed to fetch Bitbucket commits. Status: ${response.status}. ${errorBody}`
        );
      }


      const data =
        (await response.json()) as BitbucketCommitsResponse;


      commits.push(
        ...data.values.map(
          BitbucketNormalizer.commit
        )
      );


      apiUrl =
        data.next;
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
      workspace,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const encodedCommitSha =
      encodeURIComponent(
        commitSha
      );


    const apiUrl =
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repository}/commit/${encodedCommitSha}`;


    const response =
      await fetch(apiUrl, {
        method: "GET",
        headers: this.getHeaders(token)
      });


    if (!response.ok) {

      const errorBody =
        await response.text();

      throw new Error(
        `Failed to fetch Bitbucket commit '${commitSha}'. Status: ${response.status}. ${errorBody}`
      );
    }


    const data =
      (await response.json()) as BitbucketCommitData;


    return BitbucketNormalizer.commit(
      data
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
      workspace,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const pullRequests:
      ScmPullRequest[] = [];


    let nextUrl:
      string | undefined =
        `https://api.bitbucket.org/2.0/repositories/${workspace}/${repository}/pullrequests?pagelen=50`;


    while (nextUrl) {

      const response =
        await fetch(nextUrl, {
          method: "GET",
          headers: this.getHeaders(token)
        });


      if (!response.ok) {

        const errorBody =
          await response.text();

        throw new Error(
          `Failed to fetch Bitbucket pull requests. Status: ${response.status}. ${errorBody}`
        );
      }


      const data =
        (await response.json()) as BitbucketPullRequestsResponse;


      const normalizedPullRequests =
        data.values
          .filter(
            (item) => {

              const itemState =
                item.state.toUpperCase();


              if (state === "all") {
                return true;
              }


              if (state === "open") {
                return itemState === "OPEN";
              }


              return itemState !== "OPEN";
            }
          )
          .map(
            BitbucketNormalizer.pullRequest
          );


      pullRequests.push(
        ...normalizedPullRequests
      );


      nextUrl =
        data.next;
    }


    return pullRequests;
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
      workspace,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const apiUrl =
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repository}/pullrequests`;


    const response =
      await fetch(apiUrl, {
        method: "POST",

        headers: {
          ...this.getHeaders(token),

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            title,

            description:
              body ?? "",

            source: {
              branch: {
                name:
                  sourceBranch
              }
            },

            destination: {
              branch: {
                name:
                  targetBranch
              }
            }
          })
      });


    if (!response.ok) {

      const errorBody =
        await response.text();

      throw new Error(
        `Failed to create Bitbucket Pull Request. Status: ${response.status}. ${errorBody}`
      );
    }


    const data =
      (await response.json()) as BitbucketPullRequestData;


    return BitbucketNormalizer.pullRequest(
      data
    );
  }


  async getPullRequest(
  token: string,
  repositoryUrl: string,
  pullRequestNumber: number
): Promise<ScmPullRequest> {

  const operation =
    "getPullRequest";


  try {

    if (
      !Number.isInteger(
        pullRequestNumber
      ) ||
      pullRequestNumber <= 0
    ) {

      throw BitbucketErrorMapper.fromHttpResponse(
        400,
        "A valid Pull Request number is required.",
        operation
      );
    }


    const {
      workspace,
      repository
    } = this.parseRepositoryUrl(
      repositoryUrl
    );


    const apiUrl =
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repository}/pullrequests/${pullRequestNumber}`;


    const response =
      await fetch(apiUrl, {
        method: "GET",
        headers: this.getHeaders(token)
      });


    if (!response.ok) {

      const errorBody =
        await response.text();


      const retryAfterHeader =
        response.headers.get(
          "retry-after"
        );


      const retryAfterSeconds =
        retryAfterHeader
          ? Number(
              retryAfterHeader
            )
          : undefined;


      throw BitbucketErrorMapper.fromHttpResponse(
        response.status,
        errorBody ||
          `Bitbucket Pull Request #${pullRequestNumber} request failed.`,
        operation,
        Number.isFinite(
          retryAfterSeconds
        )
          ? retryAfterSeconds
          : undefined
      );
    }


    const data =
      (await response.json()) as BitbucketPullRequestData;


    return BitbucketNormalizer.pullRequest(
      data
    );

  } catch (error) {

    throw BitbucketErrorMapper.map(
      error,
      operation
    );
  }
}

  // =========================================================
// FR-SCM-009: WEBHOOKS
// =========================================================

async listWebhooks(
  token: string,
  repositoryUrl: string
): Promise<ScmWebhook[]> {

  const {
    workspace,
    repository
  } = this.parseRepositoryUrl(
    repositoryUrl
  );


  const webhooks:
    ScmWebhook[] = [];


  let nextUrl:
    string | undefined =
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repository}/hooks?pagelen=100`;


  while (nextUrl) {

    const response =
      await fetch(nextUrl, {
        method: "GET",
        headers: this.getHeaders(token)
      });


    if (!response.ok) {

      const errorBody =
        await response.text();

      throw new Error(
        `Failed to fetch Bitbucket webhooks. Status: ${response.status}. ${errorBody}`
      );
    }


    const data =
      (await response.json()) as BitbucketWebhooksResponse;


    webhooks.push(
      ...data.values.map(
        BitbucketNormalizer.webhook
      )
    );


    nextUrl =
      data.next;
  }


  return webhooks;
}

  // =========================================================
  // PRIVATE HELPERS
  // =========================================================

  private parseRepositoryUrl(
    repositoryUrl: string
  ): {
    workspace: string;
    repository: string;
  } {

    let parsedUrl: URL;


    try {

      parsedUrl =
        new URL(
          repositoryUrl
        );

    } catch {

      throw new Error(
        `Invalid Bitbucket repository URL: ${repositoryUrl}`
      );
    }


    if (
      parsedUrl.hostname.toLowerCase() !==
      "bitbucket.org"
    ) {

      throw new Error(
        `Invalid Bitbucket repository URL: ${repositoryUrl}`
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


    if (parts.length < 2) {

      throw new Error(
        `Invalid Bitbucket repository URL: ${repositoryUrl}`
      );
    }


    const workspace =
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
      workspace,
      repository
    };
  }


  private normalizeRepositoryPath(
    path: string
  ): string {

    return path
      .split("/")
      .filter(Boolean)
      .join("/");
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
    token: string
  ): Record<string, string> {

    return {
      Authorization:
        `Bearer ${token}`,

      Accept:
        "application/json"
    };
  }
}