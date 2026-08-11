import { and, eq, sql } from "drizzle-orm";

import {
  chunkEmbeddings,
  documentChunks,
  repositories,
  type Database,
} from "@swega/db";
import { validateEmbeddings, type EmbeddingProvider } from "@swega/embeddings";
import { EMBEDDING_DIMENSIONS, repositoryIdSchema } from "@swega/shared";
import { errorFields, type Logger } from "@swega/shared/logging";

const DEFAULT_EMBEDDING_BATCH_SIZE = 64;
const MAX_EMBEDDING_BATCH_SIZE = 256;

export interface EmbedRepositoryMemoryOptions {
  database: Database;
  embeddings: EmbeddingProvider;
  logger: Logger;
  repositoryId: string;
  batchSize?: number;
}

export interface EmbedRepositoryMemoryResult {
  repositoryId: string;
  chunks: number;
  embedded: number;
  skipped: number;
  unchanged: number;
  durationMs: number;
}

export class RepositoryMemoryEmbeddingError extends Error {
  override readonly name = "RepositoryMemoryEmbeddingError";
  readonly repositoryId: string;
  override readonly cause: unknown;

  constructor(repositoryId: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Embedding repository memory failed for ${repositoryId}: ${message}`);
    this.repositoryId = repositoryId;
    this.cause = cause;
  }
}

export async function embedRepositoryMemory(
  options: EmbedRepositoryMemoryOptions,
): Promise<EmbedRepositoryMemoryResult> {
  const startedAt = performance.now();
  const repositoryId = repositoryIdSchema.parse(options.repositoryId);
  const batchSize = options.batchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_EMBEDDING_BATCH_SIZE
  ) {
    throw new Error(
      `Embedding batch size must be between 1 and ${MAX_EMBEDDING_BATCH_SIZE}`,
    );
  }
  if (options.embeddings.dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding provider dimensions must be ${EMBEDDING_DIMENSIONS}`,
    );
  }
  const logger = options.logger.child({
    component: "memory_embeddings",
    repositoryId,
    embeddingProvider: options.embeddings.provider,
    embeddingModel: options.embeddings.model,
  });
  logger.info("memory_embeddings.started", { batchSize });

  try {
    const repository = await options.database
      .select({ id: repositories.id })
      .from(repositories)
      .where(eq(repositories.id, repositoryId))
      .limit(1);
    if (!repository[0]) {
      throw new Error(`Repository '${repositoryId}' is not registered`);
    }
    const rows = await options.database
      .select({
        chunkId: documentChunks.id,
        content: documentChunks.content,
        contentHash: documentChunks.contentHash,
        embeddedProvider: chunkEmbeddings.provider,
        embeddedModel: chunkEmbeddings.model,
        embeddedDimensions: chunkEmbeddings.dimensions,
        embeddedContentHash: chunkEmbeddings.contentHash,
      })
      .from(documentChunks)
      .leftJoin(
        chunkEmbeddings,
        and(
          eq(documentChunks.repositoryId, chunkEmbeddings.repositoryId),
          eq(documentChunks.id, chunkEmbeddings.chunkId),
        ),
      )
      .where(eq(documentChunks.repositoryId, repositoryId));
    const stale = rows.filter(
      (row) =>
        row.embeddedProvider !== options.embeddings.provider ||
        row.embeddedModel !== options.embeddings.model ||
        row.embeddedDimensions !== options.embeddings.dimensions ||
        row.embeddedContentHash !== row.contentHash,
    );

    for (let offset = 0; offset < stale.length; offset += batchSize) {
      const batch = stale.slice(offset, offset + batchSize);
      const vectors = validateEmbeddings(
        options.embeddings,
        batch.map((row) => row.content),
        await options.embeddings.embed(batch.map((row) => row.content)),
      );
      const embeddedAt = new Date();
      const values = batch.map((row, index) => {
        const embedding = vectors[index];
        if (!embedding) {
          throw new Error(`No embedding returned for chunk '${row.chunkId}'`);
        }
        return {
          chunkId: row.chunkId,
          repositoryId,
          provider: options.embeddings.provider,
          model: options.embeddings.model,
          dimensions: options.embeddings.dimensions,
          contentHash: row.contentHash,
          embedding,
          embeddedAt,
        };
      });
      await options.database
        .insert(chunkEmbeddings)
        .values(values)
        .onConflictDoUpdate({
          target: [chunkEmbeddings.repositoryId, chunkEmbeddings.chunkId],
          set: {
            provider: sql`excluded.provider`,
            model: sql`excluded.model`,
            dimensions: sql`excluded.dimensions`,
            contentHash: sql`excluded.content_hash`,
            embedding: sql`excluded.embedding`,
            embeddedAt,
          },
        });
      logger.info("memory_embeddings.batch.completed", {
        embedded: batch.length,
        completed: Math.min(offset + batch.length, stale.length),
        total: stale.length,
      });
    }

    const result: EmbedRepositoryMemoryResult = {
      repositoryId,
      chunks: rows.length,
      embedded: stale.length,
      skipped: rows.length - stale.length,
      unchanged: rows.length - stale.length,
      durationMs: Math.round(performance.now() - startedAt),
    };
    logger.info("memory_embeddings.completed", {
      chunks: result.chunks,
      embedded: result.embedded,
      skipped: result.skipped,
      unchanged: result.unchanged,
      durationMs: result.durationMs,
    });
    return result;
  } catch (error) {
    logger.error("memory_embeddings.failed", {
      durationMs: Math.round(performance.now() - startedAt),
      ...errorFields(error),
    });
    throw new RepositoryMemoryEmbeddingError(repositoryId, error);
  }
}
