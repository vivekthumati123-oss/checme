import "dotenv/config";

import {
  ProviderDetector
} from "./detection/providerDetector";

import {
  ProviderFactory
} from "./core/providerFactory";

import {
  EnvironmentCredentialProvider
} from "./auth/environmentCredentialProvider";


// =========================================================
// SCM SERVICES
// =========================================================

const providerDetector =
  new ProviderDetector();


const credentialProvider =
  new EnvironmentCredentialProvider();


// =========================================================
// GET REPOSITORY THROUGH EXISTING SCM BRIDGE
// =========================================================
//
// Important:
//
// This does NOT implement GitHub or Bitbucket access again.
//
// It reuses:
//
// ProviderDetector
//     ↓
// ProviderFactory
//     ↓
// EnvironmentCredentialProvider
//     ↓
// ScmProvider.getRepository()
//
// =========================================================

export async function getRepositoryForCopilot(
  repositoryUrl: string
) {

  if (
    !repositoryUrl ||
    !repositoryUrl.trim()
  ) {

    throw new Error(
      "repositoryUrl is required."
    );
  }


  const normalizedUrl =
    repositoryUrl.trim();


  const providerType =
    providerDetector.detect(
      normalizedUrl
    );


  const provider =
    ProviderFactory.create(
      providerType
    );


  const token =
    credentialProvider.getToken(
      providerType
    );


  const repository =
    await provider.getRepository(
      token,
      normalizedUrl
    );


  return {
    provider:
      providerType,

    repository
  };
}