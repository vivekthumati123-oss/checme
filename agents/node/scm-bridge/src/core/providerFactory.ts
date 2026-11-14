import {
  ScmProvider
} from "../types/scmProvider";

import {
  GitLabProvider
} from "../providers/gitlab/gitlabProvider";

import {
  ScmProviderType
} from "../types/scmProviderType";

import {
  GitHubProvider
} from "../providers/github/githubProvider";

import {
  BitbucketProvider
} from "../providers/bitbucket/bitbucketProvider";

import {
  AzureReposProvider
} from "../providers/azure/azureReposProvider";




export class ProviderFactory {

  static create(
    providerType: ScmProviderType
  ): ScmProvider {

    switch (providerType) {

      case "github":

        return new GitHubProvider();


      case "bitbucket":

        return new BitbucketProvider();


      case "azure-repos":

        return new AzureReposProvider();

      case "gitlab":
return new GitLabProvider();



      default:

        throw new Error(
          `SCM provider is not implemented yet: ${providerType}`
        );
    }
  }
}