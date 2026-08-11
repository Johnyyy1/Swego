import type { RepositoryLocator } from "@swega/shared";

export interface GitCommit {
  hash: string;
  parents: readonly string[];
  authorName: string;
  authorEmail: string;
  authoredAt: Date;
  committedAt: Date;
  subject: string;
  body: string;
}

export interface GitHistorySource {
  streamCommits(repository: RepositoryLocator): AsyncIterable<GitCommit>;
}
