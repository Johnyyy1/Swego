import type { MemorySourceType, RepositoryId } from "@swega/shared";

export interface RepositoryContextQuery {
  repositoryId: RepositoryId;
  text: string;
  before?: Date;
  limit?: number;
}

export interface RepositoryContextItem {
  sourceId: string;
  sourceType: MemorySourceType;
  parentSourceType: MemorySourceType | null;
  parentSourceEntityId: string | null;
  sourceReference: string;
  summary: string;
  occurredAt: Date;
  availableAt: Date;
  path: string | null;
  commitSha: string | null;
  score?: number;
}

export interface RepositoryMemory {
  findContext(
    query: RepositoryContextQuery,
  ): Promise<readonly RepositoryContextItem[]>;
}
