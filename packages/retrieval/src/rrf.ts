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
  rrfScore: number;
}

export function reciprocalRankFusion(
  denseResults: readonly MemorySearchResult[],
  lexicalResults: readonly MemorySearchResult[],
  options: ReciprocalRankFusionOptions,
  structuredResults: readonly MemorySearchResult[] = [],
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
      rrfScore: candidate.rrfScore,
      rrfRank: index + 1,
    }));
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
  );
}
