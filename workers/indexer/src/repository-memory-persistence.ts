import { and, asc, eq, gt, isNull, lt, notInArray, or, sql } from "drizzle-orm";

import { documentChunks, documents, type Database } from "@swega/db";
import type { GeneratedMemoryDocument } from "@swega/documents";

export interface MemoryPersistenceResult {
  documents: number;
  chunks: number;
}

export async function persistMemoryDocuments(
  database: Database,
  generatedDocuments: readonly GeneratedMemoryDocument[],
  indexedAt: Date,
): Promise<MemoryPersistenceResult> {
  let chunkCount = 0;

  await database.transaction(async (transaction) => {
    for (const generated of generatedDocuments) {
      const { document, chunks } = generated;
      const laterVersions = await transaction
        .select({ availableAt: documents.availableAt })
        .from(documents)
        .where(
          and(
            eq(documents.repositoryId, document.repositoryId),
            eq(documents.sourceType, document.sourceType),
            eq(documents.sourceEntityId, document.sourceEntityId),
            gt(documents.availableAt, document.availableAt),
          ),
        )
        .orderBy(asc(documents.availableAt))
        .limit(1);
      const supersededAt = laterVersions[0]?.availableAt ?? null;

      await transaction
        .insert(documents)
        .values({
          id: document.id,
          repositoryId: document.repositoryId,
          sourceType: document.sourceType,
          sourceEntityId: document.sourceEntityId,
          parentSourceType: document.parentSourceType,
          parentSourceEntityId: document.parentSourceEntityId,
          sourceVersion: document.sourceVersion,
          sourceReference: document.sourceReference,
          title: document.title,
          contentHash: document.contentHash,
          chunkingStrategy: document.chunkingStrategy,
          occurredAt: document.occurredAt,
          availableAt: document.availableAt,
          supersededAt,
          path: document.path,
          commitSha: document.commitSha,
          indexedAt,
        })
        .onConflictDoUpdate({
          target: documents.id,
          set: {
            parentSourceType: sql`excluded.parent_source_type`,
            parentSourceEntityId: sql`excluded.parent_source_entity_id`,
            sourceReference: sql`excluded.source_reference`,
            title: sql`excluded.title`,
            contentHash: sql`excluded.content_hash`,
            chunkingStrategy: sql`excluded.chunking_strategy`,
            occurredAt: sql`excluded.occurred_at`,
            availableAt: sql`excluded.available_at`,
            supersededAt,
            path: sql`excluded.path`,
            commitSha: sql`excluded.commit_sha`,
            indexedAt,
          },
        });

      for (const chunk of chunks) {
        await transaction
          .insert(documentChunks)
          .values({
            ...chunk,
            supersededAt,
            indexedAt,
          })
          .onConflictDoUpdate({
            target: documentChunks.id,
            set: {
              parentSourceType: sql`excluded.parent_source_type`,
              parentSourceEntityId: sql`excluded.parent_source_entity_id`,
              sourceReference: sql`excluded.source_reference`,
              chunkIndex: sql`excluded.chunk_index`,
              content: sql`excluded.content`,
              contentHash: sql`excluded.content_hash`,
              occurredAt: sql`excluded.occurred_at`,
              availableAt: sql`excluded.available_at`,
              supersededAt,
              path: sql`excluded.path`,
              commitSha: sql`excluded.commit_sha`,
              startLine: sql`excluded.start_line`,
              endLine: sql`excluded.end_line`,
              indexedAt,
            },
          });
      }

      const currentChunkIds = chunks.map((chunk) => chunk.id);
      await transaction
        .delete(documentChunks)
        .where(
          and(
            eq(documentChunks.repositoryId, document.repositoryId),
            eq(documentChunks.documentId, document.id),
            ...(currentChunkIds.length > 0
              ? [notInArray(documentChunks.id, currentChunkIds)]
              : []),
          ),
        );

      const olderVersion = and(
        eq(documents.repositoryId, document.repositoryId),
        eq(documents.sourceType, document.sourceType),
        eq(documents.sourceEntityId, document.sourceEntityId),
        lt(documents.availableAt, document.availableAt),
        or(
          isNull(documents.supersededAt),
          gt(documents.supersededAt, document.availableAt),
        ),
      );
      await transaction
        .update(documents)
        .set({ supersededAt: document.availableAt })
        .where(olderVersion);
      await transaction
        .update(documentChunks)
        .set({ supersededAt: document.availableAt })
        .where(
          and(
            eq(documentChunks.repositoryId, document.repositoryId),
            eq(documentChunks.sourceType, document.sourceType),
            eq(documentChunks.sourceEntityId, document.sourceEntityId),
            lt(documentChunks.availableAt, document.availableAt),
            or(
              isNull(documentChunks.supersededAt),
              gt(documentChunks.supersededAt, document.availableAt),
            ),
          ),
        );

      chunkCount += chunks.length;
    }
  });

  return { documents: generatedDocuments.length, chunks: chunkCount };
}
