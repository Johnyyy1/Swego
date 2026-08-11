import type { MemorySourceType, RepositoryId } from "@swega/shared";

export interface SearchMemoryInput {
  repositoryId: RepositoryId;
  query: string;
  limit?: number;
  before?: Date;
}

export interface MemorySourceMetadata {
  documentId: string;
  chunkId: string;
  sourceReference: string;
  parentSourceType: MemorySourceType | null;
  parentSourceEntityId: string | null;
  occurredAt: Date;
  availableAt: Date;
  path: string | null;
  commitSha: string | null;
  startLine: number | null;
  endLine: number | null;
}

export interface MemorySearchResult {
  repositoryId: RepositoryId;
  content: string;
  similarity: number;
  sourceType: MemorySourceType;
  sourceId: string;
  timestamp: Date;
  path: string | null;
  sourceMetadata: MemorySourceMetadata;
}

export interface RepositoryMemory {
  searchMemory(
    input: SearchMemoryInput,
  ): Promise<readonly MemorySearchResult[]>;
}
