import {
  ScmRepository
} from "../types/scmRepository";


export interface GitLabRepositoryData {
  id: number;

  name: string;

  path_with_namespace: string;

  web_url: string;

  http_url_to_repo: string;

  default_branch: string | null;

  visibility: string;
}


export class GitLabNormalizer {

  static repository(
    item: GitLabRepositoryData
  ): ScmRepository {

    return {
      id:
        item.id.toString(),

      name:
        item.name,

      fullName:
        item.path_with_namespace,

      url:
        item.web_url,

      cloneUrl:
        item.http_url_to_repo,

      defaultBranch:
        item.default_branch ?? "",

      private:
        item.visibility !==
        "public",

      provider:
        "gitlab"
    };
  }
}