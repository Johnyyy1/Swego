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
  denseSimilarity?: number;
  lexicalScore?: number;
  rrfScore: number;
}

export function reciprocalRankFusion(
  denseResults: readonly MemorySearchResult[],
  lexicalResults: readonly MemorySearchResult[],
  options: ReciprocalRankFusionOptions,
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
    .map(([, candidate]) => ({
      ...candidate.result,
      similarity: candidate.denseSimilarity ?? 0,
      ...(candidate.denseRank === undefined
        ? {}
        : { denseRank: candidate.denseRank }),
      ...(candidate.lexicalRank === undefined
        ? {}
        : { lexicalRank: candidate.lexicalRank }),
      ...(candidate.denseSimilarity === undefined
        ? {}
        : { denseSimilarity: candidate.denseSimilarity }),
      ...(candidate.lexicalScore === undefined
        ? {}
        : { lexicalScore: candidate.lexicalScore }),
      rrfScore: candidate.rrfScore,
    }));
}

function addRankedResults(
  candidates: Map<string, FusionCandidate>,
  results: readonly MemorySearchResult[],
  retriever: "dense" | "lexical",
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
    } else {
      candidate.lexicalRank = rank;
      if (result.lexicalScore !== undefined) {
        candidate.lexicalScore = result.lexicalScore;
      }
    }
    candidates.set(chunkId, candidate);
  });
}

function bestRank(candidate: FusionCandidate): number {
  return Math.min(
    candidate.denseRank ?? Number.POSITIVE_INFINITY,
    candidate.lexicalRank ?? Number.POSITIVE_INFINITY,
  );
}
