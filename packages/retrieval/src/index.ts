import type { RepositoryId } from "@swega/shared";

export interface RepositoryContextQuery {
  repositoryId: RepositoryId;
  text: string;
  limit?: number;
}

export interface RepositoryContextItem {
  sourceId: string;
  sourceType: "commit" | "issue" | "pull_request" | "review" | "comment";
  summary: string;
  occurredAt: Date;
  score?: number;
}

export interface RepositoryMemory {
  findContext(
    query: RepositoryContextQuery,
  ): Promise<readonly RepositoryContextItem[]>;
}
