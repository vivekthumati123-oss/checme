import { ScmProviderType } from "./scmProviderType";

export interface ScmRepository {
  id: string;
  name: string;
  fullName: string;
  url: string;
  cloneUrl: string;
  defaultBranch: string;
  private: boolean;
  provider: ScmProviderType;
}