import type { documentChunks } from "@swega/db";

import type { MemorySearchResult } from "./types";

export type DocumentChunkRow = typeof documentChunks.$inferSelect;

export function documentChunkToMemorySearchResult(
  chunk: DocumentChunkRow,
): MemorySearchResult {
  return {
    repositoryId: chunk.repositoryId,
    content: chunk.content,
    similarity: 0,
    sourceType: chunk.sourceType,
    sourceId: chunk.sourceEntityId,
    timestamp: chunk.availableAt,
    path: chunk.path,
    sourceMetadata: {
      documentId: chunk.documentId,
      chunkId: chunk.id,
      sourceReference: chunk.sourceReference,
      parentSourceType: chunk.parentSourceType,
      parentSourceEntityId: chunk.parentSourceEntityId,
      occurredAt: chunk.occurredAt,
      availableAt: chunk.availableAt,
      path: chunk.path,
      commitSha: chunk.commitSha,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      language: chunk.language,
      symbolId: chunk.symbolId,
      symbolName: chunk.symbolName,
      symbolKind: chunk.symbolKind,
      parentSymbol: chunk.parentSymbol,
      symbolPart: chunk.symbolPart,
      symbolPartCount: chunk.symbolPartCount,
    },
  };
}
