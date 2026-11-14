export interface ScmCommit {
  sha: string;
  message: string;

  authorName?: string;
  authorEmail?: string;
  authorDate?: string;

  committerName?: string;
  committerEmail?: string;
  committerDate?: string;

  url?: string;
}