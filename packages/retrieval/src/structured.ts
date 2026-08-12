import { and, asc, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";

import { documentChunks, type Database } from "@swega/db";

import {
  MAX_INTERNAL_CANDIDATE_LIMIT,
  normalizeSearchMemoryInput,
} from "./search-input";
import type {
  MemorySearchResult,
  RepositoryMemory,
  SearchMemoryInput,
} from "./types";

export class PgStructuredRepositoryMemory implements RepositoryMemory {
  constructor(private readonly database: Database) {}

  async searchMemory(
    input: SearchMemoryInput,
  ): Promise<readonly MemorySearchResult[]> {
    const { repositoryId, query, limit, before } = normalizeSearchMemoryInput(
      input,
      MAX_INTERNAL_CANDIDATE_LIMIT,
    );
    const queryTerms = structuralQueryTerms(query);
    if (queryTerms.length === 0) {
      return [];
    }
    const prefixQuery = queryTerms.map((term) => `${term}:*`).join(" | ");
    const structuredQuery = sql`to_tsquery('simple', ${prefixQuery})`;
    const exactMatch = sql<boolean>`coalesce(${documentChunks.symbolName} = ${query}, false)`;
    const structuralMatch = sql<boolean>`${documentChunks.structuralSearchVector} @@ ${structuredQuery}`;
    const structuredScore = sql<number>`ts_rank_cd(${documentChunks.structuralSearchVector}, ${structuredQuery})`;
    const rows = await this.database
      .select({
        repositoryId: documentChunks.repositoryId,
        documentId: documentChunks.documentId,
        chunkId: documentChunks.id,
        content: documentChunks.content,
        structuredScore,
        exactMatch,
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
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.repositoryId, repositoryId),
          lte(documentChunks.availableAt, before),
          or(
            isNull(documentChunks.supersededAt),
            gt(documentChunks.supersededAt, before),
          ),
          or(exactMatch, structuralMatch),
        ),
      )
      .orderBy(desc(exactMatch), desc(structuredScore), asc(documentChunks.id))
      .limit(limit);

    return rows.map((row, index) => ({
      repositoryId: row.repositoryId,
      content: row.content,
      similarity: 0,
      structuredRank: index + 1,
      structuredScore: row.structuredScore,
      structuredExactMatch: row.exactMatch,
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
}

export function normalizeStructuralQuery(query: string): string {
  return query
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

const STRUCTURAL_QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "been",
  "being",
  "did",
  "do",
  "does",
  "find",
  "for",
  "get",
  "how",
  "implementation",
  "implemented",
  "in",
  "is",
  "located",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "what",
  "where",
  "which",
  "with",
  "work",
  "works",
]);

export function structuralQueryTerms(query: string): readonly string[] {
  const normalized = normalizeStructuralQuery(query);
  const primary = normalized
    .split(" ")
    .filter((term) => term && !STRUCTURAL_QUERY_STOP_WORDS.has(term));
  const terms = new Set(primary);
  for (const term of primary) {
    if (term.length > 3 && term.endsWith("s")) {
      terms.add(term.slice(0, -1));
    }
    if (term.length > 4 && term.endsWith("ed") && term.at(-3) !== "z") {
      terms.add(term.slice(0, -2));
    }
    if (term.length > 5 && term.endsWith("ing")) {
      terms.add(term.slice(0, -3));
    }
  }
  return [...terms];
}
