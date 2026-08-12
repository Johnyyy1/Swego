import {
  and,
  asc,
  cosineDistance,
  eq,
  gt,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { chunkEmbeddings, documentChunks, type Database } from "@swega/db";
import { validateEmbeddings, type EmbeddingProvider } from "@swega/embeddings";
import { EMBEDDING_DIMENSIONS } from "@swega/shared";

import { normalizeSearchMemoryInput } from "./search-input";
import type {
  MemorySearchResult,
  RepositoryMemory,
  SearchMemoryInput,
} from "./types";

export class PgVectorRepositoryMemory implements RepositoryMemory {
  constructor(
    private readonly database: Database,
    private readonly embeddings: EmbeddingProvider,
  ) {
    if (embeddings.dimensions !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding provider dimensions must be ${EMBEDDING_DIMENSIONS}`,
      );
    }
  }

  async searchMemory(
    input: SearchMemoryInput,
  ): Promise<readonly MemorySearchResult[]> {
    const { repositoryId, query, limit, before } =
      normalizeSearchMemoryInput(input);

    await this.assertCompatibleProjection(repositoryId);

    const queryVectors = validateEmbeddings(
      this.embeddings,
      [query],
      await this.embeddings.embed([query]),
    );
    const queryVector = queryVectors[0];
    if (!queryVector) {
      throw new Error("Embedding provider returned no query vector");
    }
    const distance = cosineDistance(chunkEmbeddings.embedding, queryVector);
    const similarity = sql<number>`1 - (${distance})`;
    const rows = await this.database
      .select({
        repositoryId: documentChunks.repositoryId,
        documentId: documentChunks.documentId,
        chunkId: documentChunks.id,
        content: documentChunks.content,
        similarity,
        sourceType: documentChunks.sourceType,
        sourceId: documentChunks.sourceEntityId,
        sourceReference: documentChunks.sourceReference,
        parentSourceType: documentChunks.parentSourceType,
        parentSourceEntityId: documentChunks.parentSourceEntityId,
        occurredAt: documentChunks.occurredAt,
        availableAt: documentChunks.availableAt,
        path: documentChunks.path,
        commitSha: documentChunks.commitSha,
        startLine: documentChunks.startLine,
        endLine: documentChunks.endLine,
        language: documentChunks.language,
        symbolId: documentChunks.symbolId,
        symbolName: documentChunks.symbolName,
        symbolKind: documentChunks.symbolKind,
        parentSymbol: documentChunks.parentSymbol,
        symbolPart: documentChunks.symbolPart,
        symbolPartCount: documentChunks.symbolPartCount,
      })
      .from(chunkEmbeddings)
      .innerJoin(
        documentChunks,
        and(
          eq(chunkEmbeddings.repositoryId, documentChunks.repositoryId),
          eq(chunkEmbeddings.chunkId, documentChunks.id),
        ),
      )
      .where(
        and(
          eq(chunkEmbeddings.repositoryId, repositoryId),
          eq(chunkEmbeddings.provider, this.embeddings.provider),
          eq(chunkEmbeddings.model, this.embeddings.model),
          eq(chunkEmbeddings.dimensions, this.embeddings.dimensions),
          lte(documentChunks.availableAt, before),
          or(
            isNull(documentChunks.supersededAt),
            gt(documentChunks.supersededAt, before),
          ),
        ),
      )
      .orderBy(distance, asc(documentChunks.id))
      .limit(limit);

    return rows.map((row, index) => ({
      repositoryId: row.repositoryId,
      content: row.content,
      similarity: row.similarity,
      denseRank: index + 1,
      denseSimilarity: row.similarity,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      timestamp: row.availableAt,
      path: row.path,
      sourceMetadata: {
        documentId: row.documentId,
        chunkId: row.chunkId,
        sourceReference: row.sourceReference,
        parentSourceType: row.parentSourceType,
        parentSourceEntityId: row.parentSourceEntityId,
        occurredAt: row.occurredAt,
        availableAt: row.availableAt,
        path: row.path,
        commitSha: row.commitSha,
        startLine: row.startLine,
        endLine: row.endLine,
        language: row.language,
        symbolId: row.symbolId,
        symbolName: row.symbolName,
        symbolKind: row.symbolKind,
        parentSymbol: row.parentSymbol,
        symbolPart: row.symbolPart,
        symbolPartCount: row.symbolPartCount,
      },
    }));
  }

  private async assertCompatibleProjection(
    repositoryId: string,
  ): Promise<void> {
    const projections = await this.database
      .select({
        provider: chunkEmbeddings.provider,
        model: chunkEmbeddings.model,
        dimensions: chunkEmbeddings.dimensions,
      })
      .from(chunkEmbeddings)
      .where(eq(chunkEmbeddings.repositoryId, repositoryId))
      .groupBy(
        chunkEmbeddings.provider,
        chunkEmbeddings.model,
        chunkEmbeddings.dimensions,
      );

    if (projections.length === 0) {
      throw new EmbeddingCompatibilityError(
        repositoryId,
        this.embeddings,
        "has no stored embeddings; run embed-memory first",
      );
    }
    const incompatible = projections.find(
      (projection) =>
        projection.provider !== this.embeddings.provider ||
        projection.model !== this.embeddings.model ||
        projection.dimensions !== this.embeddings.dimensions,
    );
    if (incompatible) {
      throw new EmbeddingCompatibilityError(
        repositoryId,
        this.embeddings,
        `contains embeddings from ${incompatible.provider}/${incompatible.model} (${incompatible.dimensions} dimensions); run embed-memory to rebuild them`,
      );
    }
  }
}

export class EmbeddingCompatibilityError extends Error {
  override readonly name = "EmbeddingCompatibilityError";

  constructor(
    repositoryId: string,
    provider: EmbeddingProvider,
    detail: string,
  ) {
    super(
      `Repository '${repositoryId}' ${detail}. Configured embeddings are ${provider.provider}/${provider.model} (${provider.dimensions} dimensions).`,
    );
  }
}
