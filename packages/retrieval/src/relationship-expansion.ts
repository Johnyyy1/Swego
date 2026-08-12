import type { RepositoryId } from "@swega/shared";

import type { MemorySearchResult } from "./types";
import { diversifyCandidatesByPath } from "./diversify";

export const DEFAULT_RELATIONSHIP_MAX_ANCHORS = 12;
export const DEFAULT_RELATIONSHIP_MAX_NEIGHBORS_PER_ANCHOR = 3;
export const DEFAULT_RELATIONSHIP_CANDIDATE_LIMIT = 16;
export const DEFAULT_RELATIONSHIP_RESERVED_CANDIDATES = 4;

export interface RelationshipExpansionInput {
  repositoryId: RepositoryId;
  query: string;
  before: Date;
  anchors: readonly MemorySearchResult[];
  maxNeighborsPerAnchor: number;
  candidateLimit: number;
}

export interface RelationshipCandidateSelectionOptions {
  limit: number;
  maxCandidatesPerPath: number;
  reservedRelationshipCandidates?: number;
}

/** Reserves a small part of the fixed pool for otherwise absent one-hop evidence. */
export function selectCandidatesWithRelationshipReserve(
  fused: readonly MemorySearchResult[],
  directlyRetrievedChunkIds: ReadonlySet<string>,
  options: RelationshipCandidateSelectionOptions,
): readonly MemorySearchResult[] {
  const reserveLimit =
    options.reservedRelationshipCandidates ??
    DEFAULT_RELATIONSHIP_RESERVED_CANDIDATES;
  if (!Number.isInteger(reserveLimit) || reserveLimit < 0) {
    throw new Error("Relationship reserve must be a non-negative integer");
  }
  const selected = [...diversifyCandidatesByPath(fused, options)];
  if (reserveLimit === 0 || selected.length < options.limit) return selected;
  const selectedIds = new Set(
    selected.map((candidate) => candidate.sourceMetadata.chunkId),
  );
  const protectedRelationships = [...fused]
    .filter(
      (candidate) =>
        candidate.relationshipRank !== undefined &&
        !directlyRetrievedChunkIds.has(candidate.sourceMetadata.chunkId),
    )
    .sort(
      (left, right) =>
        (left.relationshipRank ?? Number.POSITIVE_INFINITY) -
          (right.relationshipRank ?? Number.POSITIVE_INFINITY) ||
        (left.rrfRank ?? Number.POSITIVE_INFINITY) -
          (right.rrfRank ?? Number.POSITIVE_INFINITY) ||
        left.sourceMetadata.chunkId.localeCompare(right.sourceMetadata.chunkId),
    )
    .slice(0, reserveLimit);
  const protectedIds = new Set(
    protectedRelationships.map((candidate) => candidate.sourceMetadata.chunkId),
  );
  const fusedIndex = new Map(
    fused.map((candidate, index) => [candidate.sourceMetadata.chunkId, index]),
  );
  for (const relationship of protectedRelationships) {
    const id = relationship.sourceMetadata.chunkId;
    if (selectedIds.has(id)) continue;
    const replacementIndex = findReplacementIndex(
      selected,
      relationship,
      protectedIds,
      options.maxCandidatesPerPath,
    );
    if (replacementIndex < 0) continue;
    selectedIds.delete(
      selected[replacementIndex]?.sourceMetadata.chunkId ?? "",
    );
    selected[replacementIndex] = relationship;
    selectedIds.add(id);
  }
  return selected.sort(
    (left, right) =>
      (fusedIndex.get(left.sourceMetadata.chunkId) ??
        Number.POSITIVE_INFINITY) -
        (fusedIndex.get(right.sourceMetadata.chunkId) ??
          Number.POSITIVE_INFINITY) ||
      left.sourceMetadata.chunkId.localeCompare(right.sourceMetadata.chunkId),
  );
}

function findReplacementIndex(
  selected: readonly MemorySearchResult[],
  incoming: MemorySearchResult,
  protectedRelationshipIds: ReadonlySet<string>,
  maxCandidatesPerPath: number,
): number {
  const incomingPath = incoming.path;
  const samePathCount =
    incomingPath === null
      ? 0
      : selected.filter((candidate) => candidate.path === incomingPath).length;
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const candidate = selected[index];
    if (!candidate) continue;
    if (
      candidate.structuredExactMatch === true ||
      protectedRelationshipIds.has(candidate.sourceMetadata.chunkId)
    )
      continue;
    if (
      incomingPath !== null &&
      samePathCount >= maxCandidatesPerPath &&
      candidate.path !== incomingPath
    )
      continue;
    return index;
  }
  return -1;
}

export interface RelationshipExpansion {
  expand(
    input: RelationshipExpansionInput,
  ): Promise<readonly MemorySearchResult[]>;
}

export function selectRelationshipAnchors(
  candidates: readonly MemorySearchResult[],
  maxAnchors = DEFAULT_RELATIONSHIP_MAX_ANCHORS,
): readonly MemorySearchResult[] {
  if (!Number.isInteger(maxAnchors) || maxAnchors < 1) {
    throw new Error("Relationship anchor limit must be a positive integer");
  }
  const ranked = candidates
    .map((candidate, index) => {
      const fusedRank = index + 1;
      return {
        candidate,
        index,
        evidenceRank: Math.min(
          fusedRank,
          candidate.fileEvidenceRank ?? Number.POSITIVE_INFINITY,
        ),
        strength: anchorStrength(candidate, fusedRank),
      };
    })
    .filter((item) => item.strength !== null)
    .sort(
      (left, right) =>
        (left.strength ?? 0) - (right.strength ?? 0) ||
        left.evidenceRank - right.evidenceRank ||
        left.index - right.index ||
        left.candidate.sourceMetadata.chunkId.localeCompare(
          right.candidate.sourceMetadata.chunkId,
        ),
    )
    .map((item) => item.candidate);
  const selected: MemorySearchResult[] = [];
  const seenDocuments = new Set<string>();
  for (const candidate of ranked) {
    if (seenDocuments.has(candidate.sourceMetadata.documentId)) continue;
    seenDocuments.add(candidate.sourceMetadata.documentId);
    selected.push(candidate);
    if (selected.length >= maxAnchors) break;
  }
  return selected;
}

function anchorStrength(
  candidate: MemorySearchResult,
  fusedRank: number,
): number | null {
  if (candidate.retrievedDirectly === false) return null;
  if (candidate.structuredExactMatch === true) return 0;
  const directBranches = [
    candidate.denseRank,
    candidate.lexicalRank,
    candidate.structuredRank,
  ].filter((rank) => rank !== undefined).length;
  if (directBranches >= 2) return 1;
  if ((candidate.fileEvidenceSources?.length ?? 0) >= 2) return 2;
  return fusedRank <= 5 ? 3 : null;
}
