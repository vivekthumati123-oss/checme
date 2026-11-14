export type ScmContentType =
  | "file"
  | "directory";

export interface ScmRepositoryContent {
  name: string;
  path: string;
  type: ScmContentType;
  sha: string;
  size: number;
  url?: string;
  content?: string;
}