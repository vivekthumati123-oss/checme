export interface ScmTreeItem {
  path: string;
  type: "file" | "directory";
  sha: string;
  size?: number;
}