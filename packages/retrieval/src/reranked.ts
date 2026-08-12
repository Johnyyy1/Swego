import type { Reranker, RerankScore } from "@swega/reranking";

import { MAX_SEARCH_LIMIT, normalizeSearchMemoryInput } from "./search-input";
import type {
  MemorySearchResult,
  RepositoryMemory,
  SearchMemoryInput,
} from "./types";

export const DEFAULT_RERANK_CANDIDATE_LIMIT = 30;

export interface RerankedRepositoryMemoryOptions {
  candidateLimit?: number;
}

interface ScoredMemoryResult {
  result: MemorySearchResult;
  rrfRank: number;
  rerankerScore: number;
}

export class RerankedRepositoryMemory implements RepositoryMemory {
  private readonly candidateLimit: number;

  constructor(
    private readonly hybrid: RepositoryMemory,
    private readonly reranker: Reranker,
    options: RerankedRepositoryMemoryOptions = {},
  ) {
    this.candidateLimit =
      options.candidateLimit ?? DEFAULT_RERANK_CANDIDATE_LIMIT;
    if (
      !Number.isInteger(this.candidateLimit) ||
      this.candidateLimit < 1 ||
      this.candidateLimit > MAX_SEARCH_LIMIT
    ) {
      throw new Error(
        `Rerank candidate limit must be between 1 and ${MAX_SEARCH_LIMIT}`,
      );
    }
  }

  async searchMemory(
    input: SearchMemoryInput,
  ): Promise<readonly MemorySearchResult[]> {
    const normalized = normalizeSearchMemoryInput(input);
    if (normalized.limit > this.candidateLimit) {
      throw new Error(
        `Reranked result limit ${normalized.limit} exceeds the configured candidate limit ${this.candidateLimit}`,
      );
    }

    const hybridResults = await this.hybrid.searchMemory({
      repositoryId: normalized.repositoryId,
      query: normalized.query,
      limit: this.candidateLimit,
      before: normalized.before,
    });
    const candidates = uniqueResults(hybridResults).slice(
      0,
      this.candidateLimit,
    );
    if (candidates.length === 0) {
      return [];
    }

    const scores = await this.reranker.rerank({
      query: normalized.query,
      candidates: candidates.map((result) => ({
        id: result.sourceMetadata.chunkId,
        text: formatCandidate(result),
      })),
    });
    const scoreByCandidateId = validateScores(scores, candidates);
    const scored = candidates.map<ScoredMemoryResult>((result, index) => {
      const rerankerScore = scoreByCandidateId.get(
        result.sourceMetadata.chunkId,
      );
      if (rerankerScore === undefined) {
        throw new Error(
          `Reranker omitted candidate '${result.sourceMetadata.chunkId}'`,
        );
      }
      return { result, rrfRank: index + 1, rerankerScore };
    });
    scored.sort(compareScoredResults);

    return scored.slice(0, normalized.limit).map((candidate, index) => ({
      ...candidate.result,
      rrfRank: candidate.rrfRank,
      rerankerScore: candidate.rerankerScore,
      rerankerRank: index + 1,
      finalRank: index + 1,
    }));
  }
}

function uniqueResults(
  results: readonly MemorySearchResult[],
): readonly MemorySearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const chunkId = result.sourceMetadata.chunkId;
    if (seen.has(chunkId)) {
      return false;
    }
    seen.add(chunkId);
    return true;
  });
}

function formatCandidate(result: MemorySearchResult): string {
  const lineRange =
    result.sourceMetadata.startLine === null
      ? null
      : result.sourceMetadata.endLine === null
        ? String(result.sourceMetadata.startLine)
        : `${result.sourceMetadata.startLine}-${result.sourceMetadata.endLine}`;
  return [
    ...(result.path ? [`Path: ${result.path}`] : []),
    `Source type: ${result.sourceType}`,
    ...(lineRange ? [`Lines: ${lineRange}`] : []),
    ...(result.sourceMetadata.language
      ? [`Language: ${result.sourceMetadata.language}`]
      : []),
    ...(result.sourceMetadata.symbolKind
      ? [
          `Symbol: ${result.sourceMetadata.symbolKind}${result.sourceMetadata.symbolName ? ` ${result.sourceMetadata.symbolName}` : ""}`,
        ]
      : []),
    ...(result.sourceMetadata.parentSymbol
      ? [`Parent symbol: ${result.sourceMetadata.parentSymbol}`]
      : []),
    ...(!result.path
      ? [`Source reference: ${result.sourceMetadata.sourceReference}`]
      : []),
    `Content:\n${result.content}`,
  ].join("\n");
}

function validateScores(
  scores: readonly RerankScore[],
  candidates: readonly MemorySearchResult[],
): ReadonlyMap<string, number> {
  if (scores.length !== candidates.length) {
    throw new Error(
      `Reranker returned ${scores.length} scores for ${candidates.length} candidates`,
    );
  }
  const candidateIds = new Set(
    candidates.map((candidate) => candidate.sourceMetadata.chunkId),
  );
  const scoreByCandidateId = new Map<string, number>();
  for (const score of scores) {
    if (!candidateIds.has(score.candidateId)) {
      throw new Error(
        `Reranker returned an unknown candidate ID '${score.candidateId}'`,
      );
    }
    if (scoreByCandidateId.has(score.candidateId)) {
      throw new Error(
        `Reranker returned duplicate scores for candidate '${score.candidateId}'`,
      );
    }
    if (!Number.isFinite(score.score)) {
      throw new Error(
        `Reranker returned a non-finite score for candidate '${score.candidateId}'`,
      );
    }
    scoreByCandidateId.set(score.candidateId, score.score);
  }
  return scoreByCandidateId;
}

function compareScoredResults(
  left: ScoredMemoryResult,
  right: ScoredMemoryResult,
): number {
  const scoreDifference = right.rerankerScore - left.rerankerScore;
  if (scoreDifference !== 0) {
    return scoreDifference;
  }
  const rankDifference = left.rrfRank - right.rrfRank;
  return rankDifference !== 0
    ? rankDifference
    : left.result.sourceMetadata.chunkId.localeCompare(
        right.result.sourceMetadata.chunkId,
      );
}
