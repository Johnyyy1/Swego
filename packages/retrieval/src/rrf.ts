import type { MemorySearchResult } from "./types";

export const DEFAULT_RRF_K = 60;

export interface ReciprocalRankFusionOptions {
  limit: number;
  k?: number;
}

interface FusionCandidate {
  result: MemorySearchResult;
  denseRank?: number;
  lexicalRank?: number;
  structuredRank?: number;
  denseSimilarity?: number;
  lexicalScore?: number;
  structuredScore?: number;
  structuredExactMatch?: boolean;
  fileEvidenceRank?: number;
  fileEvidenceSources?: MemorySearchResult["fileEvidenceSources"];
  fileEvidenceScore?: number;
  representativeChunkReason?: MemorySearchResult["representativeChunkReason"];
  propagatedFromFileEvidence?: boolean;
  relationshipRank?: number;
  relationshipType?: MemorySearchResult["relationshipType"];
  relationshipSourcePath?: string | null;
  relationshipSourceSymbol?: string | null;
  relationshipTargetPath?: string | null;
  relationshipTargetSymbol?: string | null;
  relationshipDepth?: 1;
  relationshipReason?: string;
  rrfScore: number;
}

export function reciprocalRankFusion(
  denseResults: readonly MemorySearchResult[],
  lexicalResults: readonly MemorySearchResult[],
  options: ReciprocalRankFusionOptions,
  structuredResults: readonly MemorySearchResult[] = [],
  fileEvidenceResults: readonly MemorySearchResult[] = [],
  relationshipResults: readonly MemorySearchResult[] = [],
): readonly MemorySearchResult[] {
  const k = options.k ?? DEFAULT_RRF_K;
  if (!Number.isFinite(k) || k < 0) {
    throw new Error("RRF k must be a non-negative finite number");
  }
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error("RRF result limit must be a positive integer");
  }

  const candidates = new Map<string, FusionCandidate>();
  addRankedResults(candidates, denseResults, "dense", k);
  addRankedResults(candidates, lexicalResults, "lexical", k);
  addRankedResults(candidates, structuredResults, "structured", k);
  addFileEvidenceResults(candidates, fileEvidenceResults, k);
  addRelationshipResults(candidates, relationshipResults, k);

  return [...candidates.entries()]
    .sort(([leftId, left], [rightId, right]) => {
      const scoreDifference = right.rrfScore - left.rrfScore;
      if (scoreDifference !== 0) {
        return scoreDifference;
      }
      const bestRankDifference = bestRank(left) - bestRank(right);
      return bestRankDifference !== 0
        ? bestRankDifference
        : leftId.localeCompare(rightId);
    })
    .slice(0, options.limit)
    .map(([, candidate], index) => ({
      ...candidate.result,
      similarity: candidate.denseSimilarity ?? 0,
      ...(candidate.denseRank === undefined
        ? {}
        : { denseRank: candidate.denseRank }),
      ...(candidate.lexicalRank === undefined
        ? {}
        : { lexicalRank: candidate.lexicalRank }),
      ...(candidate.structuredRank === undefined
        ? {}
        : { structuredRank: candidate.structuredRank }),
      ...(candidate.denseSimilarity === undefined
        ? {}
        : { denseSimilarity: candidate.denseSimilarity }),
      ...(candidate.lexicalScore === undefined
        ? {}
        : { lexicalScore: candidate.lexicalScore }),
      ...(candidate.structuredScore === undefined
        ? {}
        : { structuredScore: candidate.structuredScore }),
      ...(candidate.structuredExactMatch === undefined
        ? {}
        : { structuredExactMatch: candidate.structuredExactMatch }),
      ...(candidate.fileEvidenceRank === undefined
        ? {}
        : { fileEvidenceRank: candidate.fileEvidenceRank }),
      ...(candidate.fileEvidenceSources === undefined
        ? {}
        : { fileEvidenceSources: candidate.fileEvidenceSources }),
      ...(candidate.fileEvidenceScore === undefined
        ? {}
        : { fileEvidenceScore: candidate.fileEvidenceScore }),
      ...(candidate.representativeChunkReason === undefined
        ? {}
        : { representativeChunkReason: candidate.representativeChunkReason }),
      ...(candidate.propagatedFromFileEvidence === undefined
        ? {}
        : {
            propagatedFromFileEvidence: candidate.propagatedFromFileEvidence,
          }),
      ...(candidate.relationshipRank === undefined
        ? {}
        : {
            relationshipRank: candidate.relationshipRank,
            ...(candidate.relationshipType === undefined
              ? {}
              : { relationshipType: candidate.relationshipType }),
            ...(candidate.relationshipSourcePath === undefined
              ? {}
              : { relationshipSourcePath: candidate.relationshipSourcePath }),
            ...(candidate.relationshipSourceSymbol === undefined
              ? {}
              : {
                  relationshipSourceSymbol: candidate.relationshipSourceSymbol,
                }),
            ...(candidate.relationshipTargetPath === undefined
              ? {}
              : { relationshipTargetPath: candidate.relationshipTargetPath }),
            ...(candidate.relationshipTargetSymbol === undefined
              ? {}
              : {
                  relationshipTargetSymbol: candidate.relationshipTargetSymbol,
                }),
            ...(candidate.relationshipDepth === undefined
              ? {}
              : { relationshipDepth: candidate.relationshipDepth }),
            ...(candidate.relationshipReason === undefined
              ? {}
              : { relationshipReason: candidate.relationshipReason }),
          }),
      rrfScore: candidate.rrfScore,
      rrfRank: index + 1,
    }));
}

function addRelationshipResults(
  candidates: Map<string, FusionCandidate>,
  results: readonly MemorySearchResult[],
  k: number,
): void {
  const seen = new Set<string>();
  for (const result of results) {
    const chunkId = result.sourceMetadata.chunkId;
    if (seen.has(chunkId) || result.relationshipRank === undefined) continue;
    seen.add(chunkId);
    const candidate = candidates.get(chunkId) ?? { result, rrfScore: 0 };
    candidate.rrfScore += 1 / (k + result.relationshipRank);
    candidate.relationshipRank = result.relationshipRank;
    if (result.relationshipType !== undefined)
      candidate.relationshipType = result.relationshipType;
    if (result.relationshipSourcePath !== undefined)
      candidate.relationshipSourcePath = result.relationshipSourcePath;
    if (result.relationshipSourceSymbol !== undefined)
      candidate.relationshipSourceSymbol = result.relationshipSourceSymbol;
    if (result.relationshipTargetPath !== undefined)
      candidate.relationshipTargetPath = result.relationshipTargetPath;
    if (result.relationshipTargetSymbol !== undefined)
      candidate.relationshipTargetSymbol = result.relationshipTargetSymbol;
    if (result.relationshipDepth !== undefined)
      candidate.relationshipDepth = result.relationshipDepth;
    if (result.relationshipReason !== undefined)
      candidate.relationshipReason = result.relationshipReason;
    candidates.set(chunkId, candidate);
  }
}

function addFileEvidenceResults(
  candidates: Map<string, FusionCandidate>,
  results: readonly MemorySearchResult[],
  k: number,
): void {
  const seen = new Set<string>();
  for (const result of results) {
    const chunkId = result.sourceMetadata.chunkId;
    if (seen.has(chunkId) || result.fileEvidenceRank === undefined) {
      continue;
    }
    seen.add(chunkId);
    const existing = candidates.get(chunkId);
    const candidate = existing ?? { result, rrfScore: 0 };
    candidate.rrfScore += 1 / (k + result.fileEvidenceRank);
    if (candidate.denseRank === undefined && result.denseRank !== undefined) {
      candidate.denseRank = result.denseRank;
      candidate.denseSimilarity = result.denseSimilarity ?? result.similarity;
    }
    if (
      candidate.lexicalRank === undefined &&
      result.lexicalRank !== undefined
    ) {
      candidate.lexicalRank = result.lexicalRank;
      if (result.lexicalScore !== undefined) {
        candidate.lexicalScore = result.lexicalScore;
      }
    }
    if (
      candidate.structuredRank === undefined &&
      result.structuredRank !== undefined
    ) {
      candidate.structuredRank = result.structuredRank;
      if (result.structuredScore !== undefined) {
        candidate.structuredScore = result.structuredScore;
      }
      if (result.structuredExactMatch !== undefined) {
        candidate.structuredExactMatch = result.structuredExactMatch;
      }
    }
    candidate.fileEvidenceRank = result.fileEvidenceRank;
    if (result.fileEvidenceSources !== undefined) {
      candidate.fileEvidenceSources = result.fileEvidenceSources;
    }
    if (result.fileEvidenceScore !== undefined) {
      candidate.fileEvidenceScore = result.fileEvidenceScore;
    }
    if (result.representativeChunkReason !== undefined) {
      candidate.representativeChunkReason = result.representativeChunkReason;
    }
    candidate.propagatedFromFileEvidence = true;
    candidates.set(chunkId, candidate);
  }
}

function addRankedResults(
  candidates: Map<string, FusionCandidate>,
  results: readonly MemorySearchResult[],
  retriever: "dense" | "lexical" | "structured",
  k: number,
): void {
  const seen = new Set<string>();
  results.forEach((result, index) => {
    const chunkId = result.sourceMetadata.chunkId;
    if (seen.has(chunkId)) {
      return;
    }
    seen.add(chunkId);

    const rank = index + 1;
    const existing = candidates.get(chunkId);
    const candidate = existing ?? { result, rrfScore: 0 };
    candidate.rrfScore += 1 / (k + rank);
    if (retriever === "dense") {
      candidate.denseRank = rank;
      candidate.denseSimilarity = result.denseSimilarity ?? result.similarity;
    } else if (retriever === "lexical") {
      candidate.lexicalRank = rank;
      if (result.lexicalScore !== undefined) {
        candidate.lexicalScore = result.lexicalScore;
      }
    } else {
      candidate.structuredRank = rank;
      if (result.structuredScore !== undefined) {
        candidate.structuredScore = result.structuredScore;
      }
      if (result.structuredExactMatch !== undefined) {
        candidate.structuredExactMatch = result.structuredExactMatch;
      }
    }
    candidates.set(chunkId, candidate);
  });
}

function bestRank(candidate: FusionCandidate): number {
  return Math.min(
    candidate.denseRank ?? Number.POSITIVE_INFINITY,
    candidate.lexicalRank ?? Number.POSITIVE_INFINITY,
    candidate.structuredRank ?? Number.POSITIVE_INFINITY,
    candidate.fileEvidenceRank ?? Number.POSITIVE_INFINITY,
    candidate.relationshipRank ?? Number.POSITIVE_INFINITY,
  );
}
