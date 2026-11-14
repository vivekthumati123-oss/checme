import {
  ScmProvider
} from "../../types/scmProvider";

import {
  ScmRepository
} from "../../types/scmRepository";

import {
  ScmRepositoryContent
} from "../../types/scmRepositoryContent";

import {
  ScmTreeItem
} from "../../types/scmTreeItem";

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
  AzureReposNormalizer,
  AzureReposRepositoryData,
  AzureReposCommitData,
  AzureReposPullRequestData
} from "../../normalization/azureReposNormalizer";

import {
  AzureReposErrorMapper
} from "../../errors/azureReposErrorMapper";

interface AzureGitItem {

  objectId: string;

  gitObjectType:
    "blob" |
    "tree";

  commitId?: string;

  path: string;

  url?: string;

  content?: string;

  isFolder?: boolean;
}


interface AzureGitItemsResponse {

  count: number;

  value: AzureGitItem[];
}

interface AzureRefData {

  name: string;

  objectId: string;

  creator?: {
    displayName?: string;
    uniqueName?: string;
  };
}


interface AzureRefsResponse {

  count: number;

  value: AzureRefData[];
}


interface AzureRefUpdateResult {

  name: string;

  oldObjectId: string;

  newObjectId: string;

  isLocked?: boolean;

  success: boolean;

  updateStatus: string;

  customMessage?: string;
}


// =========================================================
// AZURE REPOS PROVIDER
// =========================================================
//
// Implemented:
//
// FR-SCM-001 Authentication
// FR-SCM-002 Provider detection
// FR-SCM-003 List/Get Repositories
// FR-SCM-010 Normalization
// FR-SCM-011 Error handling
// FR-SCM-012 Common SCM interface
//
// Remaining operations will be implemented incrementally.
//
// =========================================================

export class AzureReposProvider
  implements ScmProvider {

  readonly name =
    "azure-repos" as const;


  // =========================================================
  // FR-SCM-003: LIST REPOSITORIES
  // =========================================================
  //
  // Current ScmProvider interface uses:
  //
  // listRepositories(token, workspace?)
  //
  // For Azure Repos, workspace is temporarily interpreted
  // as:
  //
  // organization/project
  //
  // Example:
  //
  // KB00870893/axon-ghcp
  //
  // =========================================================

  async listRepositories(
    token: string,
    workspace?: string
  ): Promise<ScmRepository[]> {

    const operation =
      "listRepositories";


    try {

      if (
        !token ||
        !token.trim()
      ) {

        throw AzureReposErrorMapper.fromHttpResponse(
          401,
          "Azure DevOps token is required.",
          operation
        );
      }


      if (
        !workspace ||
        !workspace.trim()
      ) {

        throw AzureReposErrorMapper.fromHttpResponse(
          400,
          "Azure organization/project context is required.",
          operation
        );
      }


      const parts =
        workspace
          .split("/")
          .filter(Boolean);


      if (
        parts.length !== 2
      ) {

        throw AzureReposErrorMapper.fromHttpResponse(
          400,
          "Azure context must use the format organization/project.",
          operation
        );
      }


      const [
        organization,
        project
      ] =
        parts;


      const apiUrl =
        `https://dev.azure.com/${encodeURIComponent(
          organization
        )}/${encodeURIComponent(
          project
        )}/_apis/git/repositories?api-version=7.1`;


      const response =
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


      if (
        !response.ok
      ) {

        const body =
          await response.text();


        throw AzureReposErrorMapper.fromHttpResponse(
          response.status,
          body ||
            "Failed to list Azure Repos repositories.",
          operation
        );
      }


      const contentType =
        response.headers.get(
          "content-type"
        ) ?? "";


      if (
        !contentType.includes(
          "application/json"
        )
      ) {

        const body =
          await response.text();


        throw new Error(
          `Azure Repos returned a non-JSON response during ${operation}. ` +
          `Content-Type: ${contentType}. ` +
          `Response: ${body.slice(0, 500)}`
        );
      }


      const data =
        (await response.json()) as {
          count: number;
          value: AzureReposRepositoryData[];
        };


      return data.value.map(
        AzureReposNormalizer.repository
      );

    } catch (error) {

      throw AzureReposErrorMapper.map(
        error,
        operation
      );
    }
  }


  // =========================================================
  // FR-SCM-003: GET REPOSITORY
  // =========================================================

  async getRepository(
    token: string,
    repositoryUrl: string
  ): Promise<ScmRepository> {

    const operation =
      "getRepository";


    try {

      if (
        !token ||
        !token.trim()
      ) {

        throw AzureReposErrorMapper.fromHttpResponse(
          401,
          "Azure DevOps token is required.",
          operation
        );
      }


      if (
        !repositoryUrl ||
        !repositoryUrl.trim()
      ) {

        throw AzureReposErrorMapper.fromHttpResponse(
          400,
          "Azure Repos repository URL is required.",
          operation
        );
      }


      const {
        organization,
        project,
        repository
      } =
        this.parseRepositoryUrl(
          repositoryUrl
        );


      const apiUrl =
        `https://dev.azure.com/${encodeURIComponent(
          organization
        )}/${encodeURIComponent(
          project
        )}/_apis/git/repositories/${encodeURIComponent(
          repository
        )}?api-version=7.1`;


      const response =
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


      if (
        !response.ok
      ) {

        const body =
          await response.text();


        throw AzureReposErrorMapper.fromHttpResponse(
          response.status,
          body ||
            "Failed to fetch Azure Repos repository.",
          operation
        );
      }


      const contentType =
        response.headers.get(
          "content-type"
        ) ?? "";


      if (
        !contentType.includes(
          "application/json"
        )
      ) {

        const body =
          await response.text();


        throw new Error(
          `Azure Repos returned a non-JSON response during ${operation}. ` +
          `Content-Type: ${contentType}. ` +
          `Response: ${body.slice(0, 500)}`
        );
      }


      const data =
        (await response.json()) as
          AzureReposRepositoryData;


      return AzureReposNormalizer.repository(
        data
      );

    } catch (error) {

      throw AzureReposErrorMapper.map(
        error,
        operation
      );
    }
  }


  // =========================================================
  // FR-SCM-004: GET REPOSITORY CONTENT
  // =========================================================

  async getRepositoryContent(
  token: string,
  repositoryUrl: string,
  path = "",
  ref = "main"
): Promise<ScmRepositoryContent[]> {

  const operation =
    "getRepositoryContent";


  try {

    const {
      organization,
      project,
      repository
    } =
      this.parseRepositoryUrl(
        repositoryUrl
      );


    const normalizedPath =
      path
        .split("/")
        .filter(Boolean)
        .join("/");


    // =======================================================
    // SINGLE FILE / SPECIFIC PATH
    // =======================================================
    //
    // Azure Items Get:
    //
    // GET .../items
    //     ?path=/file
    //     &includeContent=true
    //     &versionDescriptor.version=branch
    //
    // =======================================================

    if (
      normalizedPath
    ) {

      const parameters =
        new URLSearchParams();


      parameters.set(
        "path",
        `/${normalizedPath}`
      );


      parameters.set(
        "includeContent",
        "true"
      );


      parameters.set(
        "includeContentMetadata",
        "true"
      );


      parameters.set(
        "versionDescriptor.version",
        ref
      );


      parameters.set(
        "versionDescriptor.versionType",
        this.isCommitSha(
          ref
        )
          ? "commit"
          : "branch"
      );


      parameters.set(
        "api-version",
        "7.1"
      );


      const apiUrl =
        `https://dev.azure.com/${encodeURIComponent(
          organization
        )}/${encodeURIComponent(
          project
        )}/_apis/git/repositories/${encodeURIComponent(
          repository
        )}/items?${parameters.toString()}`;


      const response =
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


      if (
        !response.ok
      ) {

        const body =
          await response.text();


        throw AzureReposErrorMapper.fromHttpResponse(
          response.status,
          body ||
            `Failed to fetch Azure repository item '${normalizedPath}'.`,
          operation
        );
      }


      const item =
        (await response.json()) as {
          objectId: string;
          gitObjectType: string;
          commitId?: string;
          path: string;
          url?: string;
          content?: string;
          isFolder?: boolean;
        };


      const itemPath =
        item.path
          .replace(
            /^\/+/,
            ""
          );


      const name =
        itemPath
          .split("/")
          .filter(Boolean)
          .pop() ??
        itemPath;


      return [
        {
          name,

          path:
            itemPath,

          sha:
            item.objectId ?? "",

          size:
            item.content
              ? Buffer.byteLength(
                  item.content,
                  "utf8"
                )
              : 0,

          type:
            item.gitObjectType ===
            "tree"
              ? "directory"
              : "file",

          url:
            item.url,

          content:
            item.content
        }
      ];
    }


    // =======================================================
    // ROOT / DIRECTORY CONTENT
    // =======================================================
    //
    // Azure Items List:
    //
    // recursionLevel=OneLevel
    //
    // =======================================================

    const parameters =
      new URLSearchParams();


    parameters.set(
      "scopePath",
      "/"
    );


    parameters.set(
      "recursionLevel",
      "OneLevel"
    );


    parameters.set(
      "includeContentMetadata",
      "true"
    );


    parameters.set(
      "versionDescriptor.version",
      ref
    );


    parameters.set(
      "versionDescriptor.versionType",
      this.isCommitSha(
        ref
      )
        ? "commit"
        : "branch"
    );


    parameters.set(
      "api-version",
      "7.1"
    );


    const apiUrl =
      `https://dev.azure.com/${encodeURIComponent(
        organization
      )}/${encodeURIComponent(
        project
      )}/_apis/git/repositories/${encodeURIComponent(
        repository
      )}/items?${parameters.toString()}`;


    const response =
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


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw AzureReposErrorMapper.fromHttpResponse(
        response.status,
        body ||
          "Failed to fetch Azure repository contents.",
        operation
      );
    }


    const data =
      (await response.json()) as {
        count: number;

        value: Array<{
          objectId: string;
          gitObjectType: string;
          commitId?: string;
          path: string;
          url?: string;
          isFolder?: boolean;
        }>;
      };


    return data.value
      .filter(
        item =>
          item.path !==
          "/"
      )
      .map(
        (
          item
        ): ScmRepositoryContent => {

          const itemPath =
            item.path
              .replace(
                /^\/+/,
                ""
              );


          const name =
            itemPath
              .split("/")
              .filter(Boolean)
              .pop() ??
            itemPath;


          return {
            name,

            path:
              itemPath,

            sha:
              item.objectId,

            size:
              0,

            type:
              item.gitObjectType ===
              "tree"
                ? "directory"
                : "file",

            url:
              item.url
          };
        }
      );

  } catch (error) {

    throw AzureReposErrorMapper.map(
      error,
      operation
    );
  }
}

  // =========================================================
  // FR-SCM-004: GET REPOSITORY TREE
  // =========================================================

  async getRepositoryTree(
  token: string,
  repositoryUrl: string,
  ref = "main"
): Promise<ScmTreeItem[]> {

  const operation =
    "getRepositoryTree";


  try {

    const {
      organization,
      project,
      repository
    } =
      this.parseRepositoryUrl(
        repositoryUrl
      );


    const parameters =
      new URLSearchParams();


    parameters.set(
      "scopePath",
      "/"
    );


    parameters.set(
      "recursionLevel",
      "Full"
    );


    parameters.set(
      "versionDescriptor.version",
      ref
    );


    parameters.set(
      "versionDescriptor.versionType",
      this.isCommitSha(ref)
        ? "commit"
        : "branch"
    );


    parameters.set(
      "api-version",
      "7.1"
    );


    const apiUrl =
      `https://dev.azure.com/${encodeURIComponent(
        organization
      )}/${encodeURIComponent(
        project
      )}/_apis/git/repositories/${encodeURIComponent(
        repository
      )}/items?${parameters.toString()}`;


    const response =
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


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw AzureReposErrorMapper.fromHttpResponse(
        response.status,
        body ||
          "Failed to fetch Azure repository tree.",
        operation
      );
    }


    const data =
      (await response.json()) as
        AzureGitItemsResponse;


    return data.value
      .filter(
        item =>
          item.path !== "/"
      )
      .map(
        (
          item
        ): ScmTreeItem => ({

          path:
            item.path.replace(
              /^\/+/,
              ""
            ),

          type:
            item.gitObjectType ===
            "tree"
              ? "directory"
              : "file",

          sha:
            item.objectId
        })
      );

  } catch (error) {

    throw AzureReposErrorMapper.map(
      error,
      operation
    );
  }
}
  // =========================================================
  // FR-SCM-005: LIST BRANCHES
  // =========================================================

  async listBranches(
  token: string,
  repositoryUrl: string
): Promise<ScmBranch[]> {

  const operation =
    "listBranches";


  try {

    const {
      organization,
      project,
      repository
    } =
      this.parseRepositoryUrl(
        repositoryUrl
      );


    const parameters =
      new URLSearchParams();


    parameters.set(
      "filter",
      "heads/"
    );


    parameters.set(
      "api-version",
      "7.1"
    );


    const apiUrl =
      `https://dev.azure.com/${encodeURIComponent(
        organization
      )}/${encodeURIComponent(
        project
      )}/_apis/git/repositories/${encodeURIComponent(
        repository
      )}/refs?${parameters.toString()}`;


    const response =
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


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw AzureReposErrorMapper.fromHttpResponse(
        response.status,
        body ||
          "Failed to list Azure Repos branches.",
        operation
      );
    }


    const data =
      (await response.json()) as
        AzureRefsResponse;


    return data.value.map(
  (
    item
  ): ScmBranch => ({

    name:
      this.removeHeadsPrefix(
        item.name
      ),

    sha:
      item.objectId,

    protected:
      false
  })
);

  } catch (error) {

    throw AzureReposErrorMapper.map(
      error,
      operation
    );
  }
}


  // =========================================================
  // FR-SCM-005: GET BRANCH
  // =========================================================

  async getBranch(
  token: string,
  repositoryUrl: string,
  branchName: string
): Promise<ScmBranch> {

  const operation =
    "getBranch";


  try {

    if (
      !branchName ||
      !branchName.trim()
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        400,
        "Branch name is required.",
        operation
      );
    }


    const normalizedBranchName =
      this.removeHeadsPrefix(
        branchName.trim()
      );


    const branches =
      await this.listBranches(
        token,
        repositoryUrl
      );


    const branch =
      branches.find(
        item =>
          item.name ===
          normalizedBranchName
      );


    if (
      !branch
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        404,
        `Azure branch '${normalizedBranchName}' was not found.`,
        operation
      );
    }


    return branch;

  } catch (error) {

    throw AzureReposErrorMapper.map(
      error,
      operation
    );
  }
}


  // =========================================================
  // FR-SCM-005: CREATE BRANCH
  // =========================================================

  async createBranch(
  token: string,
  repositoryUrl: string,
  branchName: string,
  fromRef: string
): Promise<ScmBranch> {

  const operation =
    "createBranch";


  try {

    if (
      !branchName ||
      !branchName.trim()
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        400,
        "New branch name is required.",
        operation
      );
    }


    if (
      !fromRef ||
      !fromRef.trim()
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        400,
        "Source branch is required.",
        operation
      );
    }


    // =====================================================
    // GET SOURCE BRANCH
    // =====================================================

    const sourceBranch =
      await this.getBranch(
        token,
        repositoryUrl,
        fromRef
      );


    // =====================================================
    // PARSE AZURE REPOSITORY
    // =====================================================

    const {
      organization,
      project,
      repository
    } =
      this.parseRepositoryUrl(
        repositoryUrl
      );


    // =====================================================
    // AZURE DEVOPS UPDATE REFS ENDPOINT
    // =====================================================

    const apiUrl =
      `https://dev.azure.com/${encodeURIComponent(
        organization
      )}/${encodeURIComponent(
        project
      )}/_apis/git/repositories/${encodeURIComponent(
        repository
      )}/refs?api-version=7.1`;


    // =====================================================
    // ZERO SHA MEANS CREATE NEW REF
    // =====================================================

    const zeroObjectId =
      "0000000000000000000000000000000000000000";


    // =====================================================
    // CREATE BRANCH
    // =====================================================

    const response =
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
            JSON.stringify([
              {
                name:
                  `refs/heads/${branchName}`,

                oldObjectId:
                  zeroObjectId,

                newObjectId:
                  sourceBranch.sha
              }
            ])
        }
      );


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw AzureReposErrorMapper.fromHttpResponse(
        response.status,
        body ||
          `Failed to create Azure branch '${branchName}'.`,
        operation
      );
    }


    const data =
      (await response.json()) as {
        count: number;

        value: Array<{
          name: string;
          oldObjectId: string;
          newObjectId: string;
          isLocked?: boolean;
          success: boolean;
          updateStatus: string;
          customMessage?: string;
        }>;
      };


    const result =
      data.value[0];


    if (
      !result
    ) {

      throw new Error(
        "Azure Repos did not return a branch creation result."
      );
    }


    if (
      !result.success
    ) {

      throw new Error(
        result.customMessage ||
        `Azure Repos failed to create branch '${branchName}'. Status: ${result.updateStatus}`
      );
    }


    // =====================================================
    // NORMALIZED SCM BRANCH
    // =====================================================

    return {
      name:
        this.removeHeadsPrefix(
          result.name
        ),

      sha:
        result.newObjectId,

      protected:
        false
    };

  } catch (error) {

    throw AzureReposErrorMapper.map(
      error,
      operation
    );
  }
}

  // =========================================================
  // FR-SCM-006: CREATE FILE
  // =========================================================

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

    if (
      !path ||
      !path.trim()
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        400,
        "File path is required.",
        operation
      );
    }


    if (
      !commitMessage ||
      !commitMessage.trim()
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        400,
        "Commit message is required.",
        operation
      );
    }


    if (
      !branch ||
      !branch.trim()
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        400,
        "Branch is required.",
        operation
      );
    }


    return await this.pushFileChange(
      token,
      repositoryUrl,
      path,
      content,
      commitMessage,
      branch,
      "add"
    );

  } catch (error) {

    throw AzureReposErrorMapper.map(
      error,
      operation
    );
  }
}


  // =========================================================
  // FR-SCM-006: UPDATE FILE
  // =========================================================

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

    if (
      !path ||
      !path.trim()
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        400,
        "File path is required.",
        operation
      );
    }


    if (
      !commitMessage ||
      !commitMessage.trim()
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        400,
        "Commit message is required.",
        operation
      );
    }


    if (
      !branch ||
      !branch.trim()
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        400,
        "Branch is required.",
        operation
      );
    }


    return await this.pushFileChange(
      token,
      repositoryUrl,
      path,
      content,
      commitMessage,
      branch,
      "edit"
    );

  } catch (error) {

    throw AzureReposErrorMapper.map(
      error,
      operation
    );
  }
}


  // =========================================================
  // FR-SCM-007: LIST COMMITS
  // =========================================================

  async listCommits(
  token: string,
  repositoryUrl: string,
  ref?: string
): Promise<ScmCommit[]> {

  const operation =
    "listCommits";


  try {

    if (
      !token ||
      !token.trim()
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        401,
        "Azure DevOps token is required.",
        operation
      );
    }


    const {
      organization,
      project,
      repository
    } =
      this.parseRepositoryUrl(
        repositoryUrl
      );


    const parameters =
      new URLSearchParams();


    if (
      ref &&
      ref.trim()
    ) {

      const normalizedRef =
        this.removeHeadsPrefix(
          ref.trim()
        );


      parameters.set(
        "searchCriteria.itemVersion.version",
        normalizedRef
      );


      parameters.set(
        "searchCriteria.itemVersion.versionType",
        this.isCommitSha(
          normalizedRef
        )
          ? "commit"
          : "branch"
      );
    }


    parameters.set(
      "api-version",
      "7.1"
    );


    const apiUrl =
      `https://dev.azure.com/${encodeURIComponent(
        organization
      )}/${encodeURIComponent(
        project
      )}/_apis/git/repositories/${encodeURIComponent(
        repository
      )}/commits?${parameters.toString()}`;


    const response =
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


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw AzureReposErrorMapper.fromHttpResponse(
        response.status,
        body ||
          "Failed to fetch Azure Repos commits.",
        operation
      );
    }


    const contentType =
      response.headers.get(
        "content-type"
      ) ?? "";


    if (
      !contentType.includes(
        "application/json"
      )
    ) {

      const body =
        await response.text();


      throw new Error(
        `Azure Repos returned a non-JSON response during ${operation}. ` +
        `Content-Type: ${contentType}. ` +
        `Response: ${body.slice(0, 500)}`
      );
    }


    const data =
      (await response.json()) as {
        count: number;
        value: AzureReposCommitData[];
      };


    return data.value.map(
      AzureReposNormalizer.commit
    );

  } catch (error) {

    throw AzureReposErrorMapper.map(
      error,
      operation
    );
  }
}


  // =========================================================
  // FR-SCM-007: GET COMMIT
  // =========================================================

 async getCommit(
  token: string,
  repositoryUrl: string,
  commitSha: string
): Promise<ScmCommit> {

  const operation =
    "getCommit";


  try {

    if (
      !token ||
      !token.trim()
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        401,
        "Azure DevOps token is required.",
        operation
      );
    }


    if (
      !commitSha ||
      !commitSha.trim()
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        400,
        "Commit SHA is required.",
        operation
      );
    }


    const {
      organization,
      project,
      repository
    } =
      this.parseRepositoryUrl(
        repositoryUrl
      );


    const normalizedCommitSha =
      commitSha.trim();


    const apiUrl =
      `https://dev.azure.com/${encodeURIComponent(
        organization
      )}/${encodeURIComponent(
        project
      )}/_apis/git/repositories/${encodeURIComponent(
        repository
      )}/commits/${encodeURIComponent(
        normalizedCommitSha
      )}?api-version=7.1`;


    const response =
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


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw AzureReposErrorMapper.fromHttpResponse(
        response.status,
        body ||
          `Failed to fetch Azure commit '${normalizedCommitSha}'.`,
        operation
      );
    }


    const contentType =
      response.headers.get(
        "content-type"
      ) ?? "";


    if (
      !contentType.includes(
        "application/json"
      )
    ) {

      const body =
        await response.text();


      throw new Error(
        `Azure Repos returned a non-JSON response during ${operation}. ` +
        `Content-Type: ${contentType}. ` +
        `Response: ${body.slice(0, 500)}`
      );
    }


    const data =
      (await response.json()) as
        AzureReposCommitData;


    return AzureReposNormalizer.commit(
      data
    );

  } catch (error) {

    throw AzureReposErrorMapper.map(
      error,
      operation
    );
  }
}


  // =========================================================
  // FR-SCM-007: CREATE COMMIT
  // =========================================================

  async createCommit(
    token: string,
    repositoryUrl: string,
    branch: string,
    message: string
  ): Promise<ScmCommit> {

    void token;
    void repositoryUrl;
    void branch;
    void message;


    throw new Error(
      "Azure Repos createCommit is not implemented yet. " +
      "Azure file changes will create commits through Push operations."
    );
  }


  // =========================================================
  // FR-SCM-008: LIST PULL REQUESTS
  // =========================================================

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

    const {
      organization,
      project,
      repository
    } =
      this.parseRepositoryUrl(
        repositoryUrl
      );


    const parameters =
      new URLSearchParams();


    parameters.set(
      "searchCriteria.status",
      state === "open"
        ? "active"
        : state === "closed"
          ? "completed"
          : "all"
    );


    parameters.set(
      "api-version",
      "7.1"
    );


    const apiUrl =
      `https://dev.azure.com/${encodeURIComponent(
        organization
      )}/${encodeURIComponent(
        project
      )}/_apis/git/repositories/${encodeURIComponent(
        repository
      )}/pullrequests?${parameters.toString()}`;


    const response =
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


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw AzureReposErrorMapper.fromHttpResponse(
        response.status,
        body ||
          "Failed to list Azure Repos Pull Requests.",
        operation
      );
    }


    const data =
      (await response.json()) as {
        count: number;
        value: AzureReposPullRequestData[];
      };


    return data.value.map(
      AzureReposNormalizer.pullRequest
    );

  } catch (error) {

    throw AzureReposErrorMapper.map(
      error,
      operation
    );
  }
}


  // =========================================================
  // FR-SCM-008: GET PULL REQUEST
  // =========================================================

  async getPullRequest(
  token: string,
  repositoryUrl: string,
  pullRequestNumber: number
): Promise<ScmPullRequest> {

  const operation =
    "getPullRequest";


  try {

    // =======================================================
    // VALIDATE TOKEN
    // =======================================================

    if (
      !token ||
      !token.trim()
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        401,
        "Azure DevOps token is required.",
        operation
      );
    }


    // =======================================================
    // VALIDATE PR NUMBER
    // =======================================================

    if (
      !Number.isInteger(
        pullRequestNumber
      ) ||
      pullRequestNumber <= 0
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        400,
        "A valid Pull Request number is required.",
        operation
      );
    }


    // =======================================================
    // PARSE REPOSITORY URL
    // =======================================================

    const {
      organization,
      project,
      repository
    } =
      this.parseRepositoryUrl(
        repositoryUrl
      );


    // =======================================================
    // AZURE DEVOPS GET PULL REQUEST API
    // =======================================================

    const apiUrl =
      `https://dev.azure.com/${encodeURIComponent(
        organization
      )}/${encodeURIComponent(
        project
      )}/_apis/git/repositories/${encodeURIComponent(
        repository
      )}/pullrequests/${pullRequestNumber}?api-version=7.1`;


    // =======================================================
    // CALL AZURE DEVOPS
    // =======================================================

    const response =
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


    // =======================================================
    // HANDLE HTTP ERROR
    // =======================================================

    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw AzureReposErrorMapper.fromHttpResponse(
        response.status,
        body ||
          `Failed to fetch Azure Pull Request #${pullRequestNumber}.`,
        operation
      );
    }


    // =======================================================
    // VERIFY JSON RESPONSE
    // =======================================================

    const contentType =
      response.headers.get(
        "content-type"
      ) ?? "";


    if (
      !contentType.includes(
        "application/json"
      )
    ) {

      const body =
        await response.text();


      throw new Error(
        `Azure Repos returned a non-JSON response during ${operation}. ` +
        `Content-Type: ${contentType}. ` +
        `Response: ${body.slice(0, 500)}`
      );
    }


    // =======================================================
    // PARSE AZURE RESPONSE
    // =======================================================

    const data =
      (await response.json()) as
        AzureReposPullRequestData;


    // =======================================================
    // FR-SCM-010 NORMALIZATION
    // =======================================================

    return AzureReposNormalizer.pullRequest(
      data
    );

  } catch (error) {

    throw AzureReposErrorMapper.map(
      error,
      operation
    );
  }
}


  // =========================================================
  // FR-SCM-008: CREATE PULL REQUEST
  // =========================================================

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

    if (
      !title ||
      !title.trim()
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        400,
        "Pull Request title is required.",
        operation
      );
    }


    if (
      !sourceBranch ||
      !sourceBranch.trim()
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        400,
        "Source branch is required.",
        operation
      );
    }


    if (
      !targetBranch ||
      !targetBranch.trim()
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        400,
        "Target branch is required.",
        operation
      );
    }


    const normalizedSource =
      this.removeHeadsPrefix(
        sourceBranch.trim()
      );


    const normalizedTarget =
      this.removeHeadsPrefix(
        targetBranch.trim()
      );


    if (
      normalizedSource ===
      normalizedTarget
    ) {

      throw AzureReposErrorMapper.fromHttpResponse(
        400,
        "Source and target branches must be different.",
        operation
      );
    }


    const {
      organization,
      project,
      repository
    } =
      this.parseRepositoryUrl(
        repositoryUrl
      );


    const apiUrl =
      `https://dev.azure.com/${encodeURIComponent(
        organization
      )}/${encodeURIComponent(
        project
      )}/_apis/git/repositories/${encodeURIComponent(
        repository
      )}/pullrequests?api-version=7.1`;


    const response =
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
              sourceRefName:
                `refs/heads/${normalizedSource}`,

              targetRefName:
                `refs/heads/${normalizedTarget}`,

              title:
                title.trim(),

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


      throw AzureReposErrorMapper.fromHttpResponse(
        response.status,
        responseBody ||
          "Failed to create Azure Repos Pull Request.",
        operation
      );
    }


    const data =
      (await response.json()) as
        AzureReposPullRequestData;


    return AzureReposNormalizer.pullRequest(
      data
    );

  } catch (error) {

    throw AzureReposErrorMapper.map(
      error,
      operation
    );
  }
}

  // =========================================================
  // FR-SCM-009: LIST SERVICE HOOKS
  // =========================================================

  async listWebhooks(
    token: string,
    repositoryUrl: string
  ): Promise<ScmWebhook[]> {

    void token;
    void repositoryUrl;


    throw new Error(
      "Azure Repos service hooks are not implemented yet."
    );
  }


  // =========================================================
  // PRIVATE: PARSE AZURE REPOSITORY URL
  // =========================================================
  //
  // Supported:
  //
  // https://dev.azure.com/{organization}/{project}/_git/{repo}
  //
  // https://{organization}.visualstudio.com/{project}/_git/{repo}
  //
  // =========================================================

  private parseRepositoryUrl(
    repositoryUrl: string
  ): {
    organization: string;
    project: string;
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
        `Invalid Azure Repos repository URL: ${repositoryUrl}`
      );
    }


    const hostname =
      parsedUrl.hostname
        .toLowerCase();


    // =========================================================
    // MODERN DEV.AZURE.COM FORMAT
    // =========================================================

    if (
      hostname ===
      "dev.azure.com"
    ) {

      const parts =
        parsedUrl.pathname
          .split("/")
          .filter(Boolean);


      const gitIndex =
        parts.indexOf(
          "_git"
        );


      if (
        gitIndex < 2 ||
        !parts[
          gitIndex + 1
        ]
      ) {

        throw new Error(
          `Invalid Azure Repos repository URL: ${repositoryUrl}`
        );
      }


      return {
        organization:
          decodeURIComponent(
            parts[0]
          ),

        project:
          decodeURIComponent(
            parts[
              gitIndex - 1
            ]
          ),

        repository:
          decodeURIComponent(
            parts[
              gitIndex + 1
            ].replace(
              /\.git$/,
              ""
            )
          )
      };
    }


    // =========================================================
    // LEGACY VISUALSTUDIO.COM FORMAT
    // =========================================================

    if (
      hostname.endsWith(
        ".visualstudio.com"
      )
    ) {

      const organization =
        hostname.split(
          "."
        )[0];


      const parts =
        parsedUrl.pathname
          .split("/")
          .filter(Boolean);


      const gitIndex =
        parts.indexOf(
          "_git"
        );


      if (
        gitIndex < 1 ||
        !parts[
          gitIndex + 1
        ]
      ) {

        throw new Error(
          `Invalid Azure Repos repository URL: ${repositoryUrl}`
        );
      }


      return {
        organization,

        project:
          decodeURIComponent(
            parts[
              gitIndex - 1
            ]
          ),

        repository:
          decodeURIComponent(
            parts[
              gitIndex + 1
            ].replace(
              /\.git$/,
              ""
            )
          )
      };
    }


    throw new Error(
      `Invalid Azure Repos repository URL: ${repositoryUrl}`
    );
  }


  private isCommitSha(
  ref: string
): boolean {

  return /^[0-9a-f]{40}$/i.test(
    ref
  );
}

private removeHeadsPrefix(
  ref: string
): string {

  return ref.replace(
    /^refs\/heads\//,
    ""
  );
}

private async pushFileChange(
  token: string,
  repositoryUrl: string,
  path: string,
  content: string,
  commitMessage: string,
  branch: string,
  changeType: "add" | "edit"
): Promise<ScmFileOperationResult> {

  const {
    organization,
    project,
    repository
  } =
    this.parseRepositoryUrl(
      repositoryUrl
    );


  // =========================================================
  // NORMALIZE FILE PATH
  // =========================================================

  const normalizedPath =
    path
      .split("/")
      .filter(Boolean)
      .join("/");


  if (
    !normalizedPath
  ) {

    throw new Error(
      "A valid file path is required."
    );
  }


  // =========================================================
  // GET CURRENT BRANCH HEAD
  // =========================================================

  const currentBranch =
    await this.getBranch(
      token,
      repositoryUrl,
      branch
    );


  // =========================================================
  // AZURE DEVOPS PUSHES API
  // =========================================================

  const apiUrl =
    `https://dev.azure.com/${encodeURIComponent(
      organization
    )}/${encodeURIComponent(
      project
    )}/_apis/git/repositories/${encodeURIComponent(
      repository
    )}/pushes?api-version=7.1`;


  // =========================================================
  // PUSH REQUEST
  // =========================================================

  const response =
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
            refUpdates: [
              {
                name:
                  `refs/heads/${branch}`,

                oldObjectId:
                  currentBranch.sha
              }
            ],

            commits: [
              {
                comment:
                  commitMessage,

                changes: [
                  {
                    changeType,

                    item: {
                      path:
                        `/${normalizedPath}`
                    },

                    newContent: {
                      content,

                      contentType:
                        "rawtext"
                    }
                  }
                ]
              }
            ]
          })
      }
    );


  if (
    !response.ok
  ) {

    const body =
      await response.text();


    throw AzureReposErrorMapper.fromHttpResponse(
      response.status,
      body ||
        `Failed to ${changeType} Azure Repos file '${normalizedPath}'.`,
      "pushFileChange"
    );
  }


  const data =
    (await response.json()) as {

      pushId: number;

      commits?: Array<{
        commitId: string;
        comment?: string;
        url?: string;
      }>;

      refUpdates?: Array<{
        name: string;
        oldObjectId: string;
        newObjectId: string;
      }>;
    };


  const commitSha =
    data.commits?.[0]?.commitId;


  if (
    !commitSha
  ) {

    throw new Error(
      "Azure Repos accepted the push but did not return a commit ID."
    );
  }


  // =========================================================
  // NORMALIZED SCM RESULT
  // =========================================================

  return {
    path:
      normalizedPath,

    sha:
      commitSha,

    commitSha,

    branch
  };
}
  // =========================================================
  // PRIVATE: HTTP HEADERS
  // =========================================================
  //
  // AZURE_DEVOPS_TOKEN contains the Azure DevOps PAT.
  //
  // Azure DevOps REST:
  //
  //        ":" + PAT
  //             ↓
  //          Base64
  //             ↓
  // Authorization: Basic <encoded>
  //
  // =========================================================

  private getHeaders(
    token: string,
    includeContentType = false
  ): Record<string, string> {

    const encodedCredential =
      Buffer
        .from(
          `:${token}`,
          "utf8"
        )
        .toString(
          "base64"
        );


    const headers:
      Record<string, string> = {

        Authorization:
          `Basic ${encodedCredential}`,

        Accept:
          "application/json"
      };


    if (
      includeContentType
    ) {

      headers[
        "Content-Type"
      ] =
        "application/json";
    }


    return headers;
  }
}