import "dotenv/config";

import { CredentialProvider } from "./credentialProvider";
import { ScmProviderType } from "../types/scmProviderType";

export class EnvironmentCredentialProvider
  implements CredentialProvider {

  getToken(provider: ScmProviderType): string {

    const credentialMap: Record<ScmProviderType, string> = {
      github: "GITHUB_TOKEN",
      gitlab: "GITLAB_TOKEN",
      bitbucket: "BITBUCKET_TOKEN",
      "azure-repos": "AZURE_DEVOPS_TOKEN"
    };

    const environmentVariable = credentialMap[provider];

    const token = process.env[environmentVariable];

    if (!token) {
      throw new Error(
        `Credential not configured for provider: ${provider}`
      );
    }

    return token;
  }
}