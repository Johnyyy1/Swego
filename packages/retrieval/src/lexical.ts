import { and, asc, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";

import { documentChunks, type Database } from "@swega/db";

import { normalizeSearchMemoryInput } from "./search-input";
import type {
  MemorySearchResult,
  RepositoryMemory,
  SearchMemoryInput,
} from "./types";

export class PgLexicalRepositoryMemory implements RepositoryMemory {
  constructor(private readonly database: Database) {}

  async searchMemory(
    input: SearchMemoryInput,
  ): Promise<readonly MemorySearchResult[]> {
    const { repositoryId, query, limit, before } =
      normalizeSearchMemoryInput(input);
    const lexicalQuery = sql`(
      replace(plainto_tsquery('english', ${query})::text, ' & ', ' | ')::tsquery
      ||
      replace(plainto_tsquery('simple', ${query})::text, ' & ', ' | ')::tsquery
    )`;
    const lexicalScore = sql<number>`ts_rank_cd(${documentChunks.searchVector}, ${lexicalQuery})`;
    const rows = await this.database
      .select({
        repositoryId: documentChunks.repositoryId,
        documentId: documentChunks.documentId,
        chunkId: documentChunks.id,
        content: documentChunks.content,
        lexicalScore,
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
      })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.repositoryId, repositoryId),
          lte(documentChunks.availableAt, before),
          or(
            isNull(documentChunks.supersededAt),
            gt(documentChunks.supersededAt, before),
          ),
          sql`${documentChunks.searchVector} @@ ${lexicalQuery}`,
        ),
      )
      .orderBy(desc(lexicalScore), asc(documentChunks.id))
      .limit(limit);

    return rows.map((row, index) => ({
      repositoryId: row.repositoryId,
      content: row.content,
      similarity: 0,
      lexicalRank: index + 1,
      lexicalScore: row.lexicalScore,
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
      },
    }));
  }
}
