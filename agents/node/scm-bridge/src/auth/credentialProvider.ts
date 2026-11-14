import { ScmProviderType } from "../types/scmProviderType";

export interface CredentialProvider {
  getToken(provider: ScmProviderType): string;
}