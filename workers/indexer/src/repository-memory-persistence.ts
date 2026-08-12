import { and, asc, eq, gt, isNull, lt, notInArray, or, sql } from "drizzle-orm";

import {
  chunkEmbeddings,
  documentChunks,
  documents,
  sourceRelationships,
  type Database,
} from "@swega/db";
import type {
  GeneratedMemoryDocument,
  SourceRelationship,
} from "@swega/documents";

const CHUNK_UPSERT_BATCH_SIZE = 100;

export interface MemoryReconciliationResult {
  documentsRemoved: number;
  chunksRemoved: number;
  embeddingsRemoved: number;
}

export interface MemoryPersistenceResult {
  documents: number;
  chunks: number;
  reconciliation: MemoryReconciliationResult;
}

export interface MemoryPersistenceOptions {
  reconcileSourceCodeForRepositoryId?: string;
  sourceRelationships?: readonly SourceRelationship[];
}

export async function persistMemoryDocuments(
  database: Database,
  generatedDocuments: readonly GeneratedMemoryDocument[],
  indexedAt: Date,
  options: MemoryPersistenceOptions = {},
): Promise<MemoryPersistenceResult> {
  let chunkCount = 0;
  let reconciliation: MemoryReconciliationResult = {
    documentsRemoved: 0,
    chunksRemoved: 0,
    embeddingsRemoved: 0,
  };

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

      for (
        let offset = 0;
        offset < chunks.length;
        offset += CHUNK_UPSERT_BATCH_SIZE
      ) {
        const batch = chunks.slice(offset, offset + CHUNK_UPSERT_BATCH_SIZE);
        await transaction
          .insert(documentChunks)
          .values(
            batch.map((chunk) => ({
              ...chunk,
              supersededAt,
              indexedAt,
            })),
          )
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
              language: sql`excluded.language`,
              symbolId: sql`excluded.symbol_id`,
              symbolName: sql`excluded.symbol_name`,
              symbolKind: sql`excluded.symbol_kind`,
              parentSymbol: sql`excluded.parent_symbol`,
              symbolPart: sql`excluded.symbol_part`,
              symbolPartCount: sql`excluded.symbol_part_count`,
              indexedAt,
            },
          });
      }

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

    if (options.reconcileSourceCodeForRepositoryId) {
      await persistSourceRelationships(
        transaction,
        options.reconcileSourceCodeForRepositoryId,
        options.sourceRelationships ?? [],
        indexedAt,
      );
    }

    if (options.reconcileSourceCodeForRepositoryId) {
      reconciliation = await reconcileSourceCodeDocuments(
        transaction,
        options.reconcileSourceCodeForRepositoryId,
        generatedDocuments,
      );
    }
  });

  return {
    documents: generatedDocuments.length,
    chunks: chunkCount,
    reconciliation,
  };
}

async function persistSourceRelationships(
  transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
  repositoryId: string,
  relationships: readonly SourceRelationship[],
  indexedAt: Date,
): Promise<void> {
  for (
    let offset = 0;
    offset < relationships.length;
    offset += CHUNK_UPSERT_BATCH_SIZE
  ) {
    const batch = relationships.slice(offset, offset + CHUNK_UPSERT_BATCH_SIZE);
    await transaction
      .insert(sourceRelationships)
      .values(batch.map((relationship) => ({ ...relationship, indexedAt })))
      .onConflictDoUpdate({
        target: sourceRelationships.id,
        set: {
          sourceSymbol: sql`excluded.source_symbol`,
          targetSymbol: sql`excluded.target_symbol`,
          availableAt: sql`excluded.available_at`,
          supersededAt: sql`excluded.superseded_at`,
          provenance: sql`excluded.provenance`,
          reason: sql`excluded.reason`,
          sourceStartLine: sql`excluded.source_start_line`,
          confidence: sql`excluded.confidence`,
          indexedAt,
        },
      });
  }
  const ids = relationships.map((relationship) => relationship.id);
  await transaction
    .delete(sourceRelationships)
    .where(
      and(
        eq(sourceRelationships.repositoryId, repositoryId),
        ...(ids.length > 0 ? [notInArray(sourceRelationships.id, ids)] : []),
      ),
    );
}

async function reconcileSourceCodeDocuments(
  transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
  repositoryId: string,
  generatedDocuments: readonly GeneratedMemoryDocument[],
): Promise<MemoryReconciliationResult> {
  const currentDocumentIds = generatedDocuments
    .filter(
      ({ document }) =>
        document.repositoryId === repositoryId &&
        document.sourceType === "source_code",
    )
    .map(({ document }) => document.id);
  const staleDocuments = and(
    eq(documents.repositoryId, repositoryId),
    eq(documents.sourceType, "source_code"),
    ...(currentDocumentIds.length > 0
      ? [notInArray(documents.id, currentDocumentIds)]
      : []),
  );

  const documentCountRows = await transaction
    .select({ count: sql<number>`count(*)::int` })
    .from(documents)
    .where(staleDocuments);
  const chunkCountRows = await transaction
    .select({ count: sql<number>`count(*)::int` })
    .from(documentChunks)
    .innerJoin(
      documents,
      and(
        eq(documentChunks.repositoryId, documents.repositoryId),
        eq(documentChunks.documentId, documents.id),
      ),
    )
    .where(staleDocuments);
  const embeddingCountRows = await transaction
    .select({ count: sql<number>`count(*)::int` })
    .from(chunkEmbeddings)
    .innerJoin(
      documentChunks,
      and(
        eq(chunkEmbeddings.repositoryId, documentChunks.repositoryId),
        eq(chunkEmbeddings.chunkId, documentChunks.id),
      ),
    )
    .innerJoin(
      documents,
      and(
        eq(documentChunks.repositoryId, documents.repositoryId),
        eq(documentChunks.documentId, documents.id),
      ),
    )
    .where(staleDocuments);

  await transaction.delete(documents).where(staleDocuments);

  return {
    documentsRemoved: documentCountRows[0]?.count ?? 0,
    chunksRemoved: chunkCountRows[0]?.count ?? 0,
    embeddingsRemoved: embeddingCountRows[0]?.count ?? 0,
  };
}
