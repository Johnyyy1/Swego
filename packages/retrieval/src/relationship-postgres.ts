import { and, asc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";

import { documentChunks, sourceRelationships, type Database } from "@swega/db";

import { documentChunkToMemorySearchResult } from "./chunk-result";
import type {
  RelationshipExpansion,
  RelationshipExpansionInput,
} from "./relationship-expansion";
import type { MemorySearchResult, RetrievalRelationshipType } from "./types";

interface RankedNeighbor {
  anchor: MemorySearchResult;
  neighborDocumentId: string;
  relationshipType: RetrievalRelationshipType;
  sourcePath: string;
  targetPath: string;
  sourceSymbol: string | null;
  targetSymbol: string | null;
  reason: string;
  relationshipId: string;
}

export class PgRelationshipExpansion implements RelationshipExpansion {
  constructor(private readonly database: Database) {}

  async expand(
    input: RelationshipExpansionInput,
  ): Promise<readonly MemorySearchResult[]> {
    if (input.anchors.length === 0) return [];
    validateBounds(input);
    const anchorByDocument = new Map(
      input.anchors.map((anchor) => [anchor.sourceMetadata.documentId, anchor]),
    );
    const anchorDocumentIds = [...anchorByDocument.keys()];
    const edges = await this.database
      .select()
      .from(sourceRelationships)
      .where(
        and(
          eq(sourceRelationships.repositoryId, input.repositoryId),
          lte(sourceRelationships.availableAt, input.before),
          or(
            isNull(sourceRelationships.supersededAt),
            gt(sourceRelationships.supersededAt, input.before),
          ),
          or(
            inArray(sourceRelationships.sourceDocumentId, anchorDocumentIds),
            inArray(sourceRelationships.targetDocumentId, anchorDocumentIds),
          ),
        ),
      )
      .orderBy(
        asc(sourceRelationships.relationshipType),
        asc(sourceRelationships.sourcePath),
        asc(sourceRelationships.targetPath),
        asc(sourceRelationships.id),
      )
      .limit(input.anchors.length * input.maxNeighborsPerAnchor * 100);

    const queryTerms = normalizedTerms(input.query);
    const neighbors = rankNeighbors(
      input.anchors,
      edges,
      input.maxNeighborsPerAnchor,
      input.candidateLimit,
      queryTerms,
    );
    if (neighbors.length === 0) return [];
    const chunks = await this.database
      .select()
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.repositoryId, input.repositoryId),
          inArray(documentChunks.documentId, [
            ...new Set(
              neighbors.map((neighbor) => neighbor.neighborDocumentId),
            ),
          ]),
          lte(documentChunks.availableAt, input.before),
          or(
            isNull(documentChunks.supersededAt),
            gt(documentChunks.supersededAt, input.before),
          ),
        ),
      )
      .orderBy(
        asc(documentChunks.documentId),
        asc(documentChunks.chunkIndex),
        asc(documentChunks.id),
      );
    const chunksByDocument = new Map<string, typeof chunks>();
    for (const chunk of chunks) {
      const grouped = chunksByDocument.get(chunk.documentId) ?? [];
      grouped.push(chunk);
      chunksByDocument.set(chunk.documentId, grouped);
    }
    return neighbors.flatMap((neighbor, index) => {
      const representative = selectRepresentativeRelationshipChunk(
        chunksByDocument.get(neighbor.neighborDocumentId) ?? [],
        neighbor.relationshipType === "imported_by"
          ? neighbor.sourceSymbol
          : neighbor.targetSymbol,
        queryTerms,
      );
      if (!representative) return [];
      return [toResult(representative, neighbor, index + 1)];
    });
  }
}

function rankNeighbors(
  anchors: readonly MemorySearchResult[],
  edges: readonly (typeof sourceRelationships.$inferSelect)[],
  maxNeighborsPerAnchor: number,
  candidateLimit: number,
  queryTerms: ReadonlySet<string>,
): readonly RankedNeighbor[] {
  const selected: RankedNeighbor[] = [];
  const seen = new Set<string>();
  const candidatesByAnchor = anchors.map((anchor) => {
    const documentId = anchor.sourceMetadata.documentId;
    const seenForAnchor = new Set<string>();
    return edges
      .flatMap<RankedNeighbor>((edge) => {
        if (edge.sourceDocumentId === documentId) {
          return [
            {
              anchor,
              neighborDocumentId: edge.targetDocumentId,
              relationshipType: edge.relationshipType,
              sourcePath: edge.sourcePath,
              targetPath: edge.targetPath,
              sourceSymbol: edge.sourceSymbol,
              targetSymbol: edge.targetSymbol,
              reason: edge.reason,
              relationshipId: edge.id,
            },
          ];
        }
        if (
          edge.targetDocumentId === documentId &&
          edge.relationshipType === "imports"
        ) {
          return [
            {
              anchor,
              neighborDocumentId: edge.sourceDocumentId,
              relationshipType: "imported_by",
              sourcePath: edge.sourcePath,
              targetPath: edge.targetPath,
              sourceSymbol: edge.sourceSymbol,
              targetSymbol: edge.targetSymbol,
              reason: edge.reason,
              relationshipId: edge.id,
            },
          ];
        }
        return [];
      })
      .sort((left, right) => compareNeighbors(left, right, queryTerms))
      .filter((candidate) => {
        if (seenForAnchor.has(candidate.neighborDocumentId)) return false;
        seenForAnchor.add(candidate.neighborDocumentId);
        return true;
      })
      .slice(0, maxNeighborsPerAnchor);
  });
  for (
    let neighborIndex = 0;
    neighborIndex < maxNeighborsPerAnchor;
    neighborIndex += 1
  ) {
    for (const candidates of candidatesByAnchor) {
      const candidate = candidates[neighborIndex];
      if (!candidate) continue;
      const key = candidate.neighborDocumentId;
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(candidate);
      if (selected.length >= candidateLimit) return selected;
    }
  }
  return selected;
}

function compareNeighbors(
  left: RankedNeighbor,
  right: RankedNeighbor,
  queryTerms: ReadonlySet<string>,
): number {
  const priority = (type: RetrievalRelationshipType): number =>
    type === "imports" ? 0 : type === "reexports" ? 1 : 2;
  return (
    priority(left.relationshipType) - priority(right.relationshipType) ||
    relationshipSymbolOverlap(right, queryTerms) -
      relationshipSymbolOverlap(left, queryTerms) ||
    Number(right.targetSymbol !== null) - Number(left.targetSymbol !== null) ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.targetPath.localeCompare(right.targetPath) ||
    left.relationshipId.localeCompare(right.relationshipId)
  );
}

function relationshipSymbolOverlap(
  neighbor: RankedNeighbor,
  queryTerms: ReadonlySet<string>,
): number {
  return [
    ...normalizedTerms(
      [neighbor.sourceSymbol, neighbor.targetSymbol].filter(Boolean).join(" "),
    ),
  ].reduce((total, term) => total + Number(queryTerms.has(term)), 0);
}

type ChunkRow = typeof documentChunks.$inferSelect;

export interface RelationshipRepresentativeChunk {
  id: string;
  chunkIndex: number;
  symbolName: string | null;
  parentSymbol: string | null;
  symbolKind: ChunkRow["symbolKind"];
}

export function selectRepresentativeRelationshipChunk<
  T extends RelationshipRepresentativeChunk,
>(
  chunks: readonly T[],
  symbol: string | null,
  queryTerms: ReadonlySet<string>,
): T | null {
  return (
    [...chunks].sort(
      (left, right) =>
        Number(right.symbolName === symbol && symbol !== null) -
          Number(left.symbolName === symbol && symbol !== null) ||
        symbolOverlap(right, queryTerms) - symbolOverlap(left, queryTerms) ||
        implementationWeight(right.symbolKind) -
          implementationWeight(left.symbolKind) ||
        Number(left.symbolKind === "module") -
          Number(right.symbolKind === "module") ||
        left.chunkIndex - right.chunkIndex ||
        left.id.localeCompare(right.id),
    )[0] ?? null
  );
}

function symbolOverlap(
  chunk: RelationshipRepresentativeChunk,
  queryTerms: ReadonlySet<string>,
): number {
  return [
    ...normalizedTerms(
      [chunk.symbolName, chunk.parentSymbol].filter(Boolean).join(" "),
    ),
  ].reduce((total, term) => total + Number(queryTerms.has(term)), 0);
}

function implementationWeight(kind: ChunkRow["symbolKind"]): number {
  return kind === "function" || kind === "method" || kind === "class"
    ? 2
    : kind === "variable" || kind === "property"
      ? 1
      : 0;
}

function normalizedTerms(value: string): Set<string> {
  return new Set(
    value
      .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((term) => term.length > 1),
  );
}

function toResult(
  chunk: ChunkRow,
  neighbor: RankedNeighbor,
  rank: number,
): MemorySearchResult {
  return {
    ...documentChunkToMemorySearchResult(chunk),
    relationshipType: neighbor.relationshipType,
    relationshipSourcePath: neighbor.anchor.path,
    relationshipSourceSymbol: neighbor.anchor.sourceMetadata.symbolName,
    relationshipTargetPath: chunk.path,
    relationshipTargetSymbol:
      neighbor.relationshipType === "imported_by"
        ? neighbor.sourceSymbol
        : neighbor.targetSymbol,
    relationshipDepth: 1,
    relationshipReason: `${neighbor.relationshipType}: ${neighbor.anchor.path ?? neighbor.anchor.sourceMetadata.sourceReference} -> ${chunk.path ?? chunk.sourceReference}; ${neighbor.reason}`,
    relationshipRank: rank,
    retrievedDirectly: false,
  };
}

function validateBounds(input: RelationshipExpansionInput): void {
  if (
    !Number.isInteger(input.maxNeighborsPerAnchor) ||
    input.maxNeighborsPerAnchor < 1
  )
    throw new Error("Relationship neighbor limit must be a positive integer");
  if (!Number.isInteger(input.candidateLimit) || input.candidateLimit < 1)
    throw new Error("Relationship candidate limit must be a positive integer");
}
