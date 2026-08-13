import {
  and,
  asc,
  between,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
} from "drizzle-orm";

import { documentChunks, repositories, type Database } from "@swega/db";

import { documentChunkToMemorySearchResult } from "./chunk-result";
import type {
  ContextEvidenceSource,
  EvidencePackRepository,
  LoadLocalContextInput,
  LocalContextCandidate,
  LocalContextReason,
} from "./context-types";

const MAX_LOCAL_CANDIDATES_PER_ANCHOR = 2;

type ChunkRow = typeof documentChunks.$inferSelect;

interface AnchorRow {
  anchorChunkId: string;
  chunk: ChunkRow;
}

export class PgContextEvidenceSource implements ContextEvidenceSource {
  constructor(private readonly database: Database) {}

  async loadRepository(repositoryId: string): Promise<EvidencePackRepository> {
    const rows = await this.database
      .select({
        id: repositories.id,
        provider: repositories.provider,
        owner: repositories.owner,
        name: repositories.name,
        url: repositories.url,
        defaultBranch: repositories.defaultBranch,
      })
      .from(repositories)
      .where(eq(repositories.id, repositoryId))
      .limit(1);
    const repository = rows[0];
    if (!repository) {
      throw new Error(`Repository '${repositoryId}' was not found`);
    }
    return repository;
  }

  async loadLocalContext(
    input: LoadLocalContextInput,
  ): Promise<readonly LocalContextCandidate[]> {
    if (input.anchors.length === 0) return [];
    const anchorIds = [
      ...new Set(input.anchors.map((anchor) => anchor.sourceMetadata.chunkId)),
    ];
    const anchorChunks = await this.database
      .select()
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.repositoryId, input.repositoryId),
          inArray(documentChunks.id, anchorIds),
          temporalPredicate(input.before),
        ),
      )
      .orderBy(asc(documentChunks.id));
    const anchorRows = anchorChunks.map<AnchorRow>((chunk) => ({
      anchorChunkId: chunk.id,
      chunk,
    }));
    if (anchorRows.length === 0) return [];

    const localConditions = anchorRows.map(({ chunk }) => {
      const structuralConditions = [
        between(
          documentChunks.chunkIndex,
          Math.max(0, chunk.chunkIndex - 1),
          chunk.chunkIndex + 1,
        ),
        ...(chunk.symbolId
          ? [eq(documentChunks.symbolId, chunk.symbolId)]
          : []),
        ...(chunk.parentSymbol
          ? [eq(documentChunks.symbolName, chunk.parentSymbol)]
          : []),
      ];
      return and(
        eq(documentChunks.documentId, chunk.documentId),
        or(...structuralConditions),
      );
    });
    const localChunks = await this.database
      .select()
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.repositoryId, input.repositoryId),
          temporalPredicate(input.before),
          or(...localConditions),
        ),
      )
      .orderBy(
        asc(documentChunks.documentId),
        asc(documentChunks.chunkIndex),
        asc(documentChunks.id),
      );

    return selectLocalCandidates(anchorRows, localChunks);
  }
}

function temporalPredicate(before: Date) {
  return and(
    lte(documentChunks.availableAt, before),
    or(
      isNull(documentChunks.supersededAt),
      gt(documentChunks.supersededAt, before),
    ),
  );
}

function selectLocalCandidates(
  anchors: readonly AnchorRow[],
  chunks: readonly ChunkRow[],
): readonly LocalContextCandidate[] {
  return anchors.flatMap(({ anchorChunkId, chunk: anchor }) =>
    chunks
      .filter(
        (candidate) =>
          candidate.documentId === anchor.documentId &&
          candidate.id !== anchor.id,
      )
      .map((candidate) => ({
        candidate,
        reason: localReason(anchor, candidate),
        distance: Math.abs(candidate.chunkIndex - anchor.chunkIndex),
      }))
      .filter(
        (
          value,
        ): value is {
          candidate: ChunkRow;
          reason: LocalContextReason;
          distance: number;
        } => value.reason !== null,
      )
      .sort(
        (left, right) =>
          localReasonPriority(left.reason) -
            localReasonPriority(right.reason) ||
          left.distance - right.distance ||
          left.candidate.chunkIndex - right.candidate.chunkIndex ||
          left.candidate.id.localeCompare(right.candidate.id),
      )
      .slice(0, MAX_LOCAL_CANDIDATES_PER_ANCHOR)
      .map(({ candidate, reason }) => ({
        anchorChunkId,
        reason,
        result: documentChunkToMemorySearchResult(candidate),
      })),
  );
}

function localReason(
  anchor: ChunkRow,
  candidate: ChunkRow,
): LocalContextReason | null {
  if (anchor.symbolId && candidate.symbolId === anchor.symbolId) {
    return "same_symbol_context";
  }
  if (
    anchor.parentSymbol &&
    candidate.symbolName === anchor.parentSymbol &&
    candidate.symbolKind !== "module"
  ) {
    return "parent_symbol";
  }
  if (Math.abs(candidate.chunkIndex - anchor.chunkIndex) === 1) {
    return anchor.symbolId && candidate.symbolId
      ? "structural_neighbor"
      : "fallback_line_context";
  }
  return null;
}

function localReasonPriority(reason: LocalContextReason): number {
  switch (reason) {
    case "same_symbol_context":
      return 0;
    case "parent_symbol":
      return 1;
    case "structural_neighbor":
      return 2;
    case "fallback_line_context":
      return 3;
  }
}
