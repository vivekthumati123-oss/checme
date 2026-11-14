import { ScmProviderType } from "../types/scmProviderType";

export class ProviderDetector {

  detect(repositoryUrl: string): ScmProviderType {

    let url: URL;

    try {
      url = new URL(repositoryUrl);
    } catch {
      throw new Error(
        `Invalid repository URL: ${repositoryUrl}`
      );
    }

    const hostname = url.hostname.toLowerCase();

    if (hostname === "github.com") {
      return "github";
    }

    if (hostname === "gitlab.com") {
      return "gitlab";
    }

    if (hostname === "bitbucket.org") {
      return "bitbucket";
    }

    if (
      hostname === "dev.azure.com" ||
      hostname.endsWith(".visualstudio.com")
    ) {
      return "azure-repos";
    }

    throw new Error(
      `Unsupported SCM provider: ${hostname}`
    );
  }
}