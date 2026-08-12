import type { Reranker, RerankScore } from "@swega/reranking";

import {
  DEFAULT_CANDIDATE_POOL_LIMIT,
  validateCandidateLimit,
} from "./candidate-generation";
import { normalizeSearchMemoryInput } from "./search-input";
import type {
  DiagnosticRepositoryMemory,
  MemorySearchResult,
  RepositoryMemory,
  SearchMemoryExecution,
  SearchMemoryInput,
} from "./types";

export const DEFAULT_RERANK_CANDIDATE_LIMIT = DEFAULT_CANDIDATE_POOL_LIMIT;

export interface RerankedRepositoryMemoryOptions {
  candidateLimit?: number;
}

interface ScoredMemoryResult {
  result: MemorySearchResult;
  rrfRank: number;
  rerankerScore: number;
}

export class RerankedRepositoryMemory implements DiagnosticRepositoryMemory {
  private readonly candidateLimit: number;

  constructor(
    private readonly hybrid: RepositoryMemory,
    private readonly reranker: Reranker,
    options: RerankedRepositoryMemoryOptions = {},
  ) {
    this.candidateLimit = validateCandidateLimit(
      options.candidateLimit ?? DEFAULT_RERANK_CANDIDATE_LIMIT,
      "Rerank",
    );
  }

  async searchMemory(
    input: SearchMemoryInput,
  ): Promise<readonly MemorySearchResult[]> {
    return (await this.searchMemoryWithDiagnostics(input)).results;
  }

  async searchMemoryWithDiagnostics(
    input: SearchMemoryInput,
  ): Promise<SearchMemoryExecution> {
    const normalized = normalizeSearchMemoryInput(input);
    if (normalized.limit > this.candidateLimit) {
      throw new Error(
        `Reranked result limit ${normalized.limit} exceeds the configured candidate limit ${this.candidateLimit}`,
      );
    }

    const candidateGenerationStartedAt = performance.now();
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
    const candidateGenerationDurationMs =
      performance.now() - candidateGenerationStartedAt;
    if (candidates.length === 0) {
      return {
        results: [],
        candidates: [],
        diagnostics: {
          candidateGenerationDurationMs,
          rerankingDurationMs: 0,
          candidateCount: 0,
          candidateBytes: 0,
        },
      };
    }

    const rerankingStartedAt = performance.now();
    const scores = await this.reranker.rerank({
      query: normalized.query,
      candidates: candidates.map((result) => ({
        id: result.sourceMetadata.chunkId,
        text: formatCandidate(result),
      })),
    });
    const rerankingDurationMs = performance.now() - rerankingStartedAt;
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
      return { result, rrfRank: result.rrfRank ?? index + 1, rerankerScore };
    });
    scored.sort(compareScoredResults);

    return {
      results: scored.slice(0, normalized.limit).map((candidate, index) => ({
        ...candidate.result,
        rrfRank: candidate.rrfRank,
        rerankerScore: candidate.rerankerScore,
        rerankerRank: index + 1,
        finalRank: index + 1,
      })),
      candidates,
      diagnostics: {
        candidateGenerationDurationMs,
        rerankingDurationMs,
        candidateCount: candidates.length,
        candidateBytes: candidates.reduce(
          (total, candidate) =>
            total + Buffer.byteLength(formatCandidate(candidate), "utf8"),
          0,
        ),
      },
    };
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
