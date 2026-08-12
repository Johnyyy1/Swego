import {
  DEFAULT_BRANCH_CANDIDATE_LIMIT,
  DEFAULT_FUSION_BRANCH_CANDIDATE_LIMIT,
  DEFAULT_MAX_CANDIDATES_PER_PATH,
  validateBranchCandidateLimit,
  validateCandidateLimit,
} from "./candidate-generation";
import { diversifyCandidatesByPath } from "./diversify";
import { normalizeSearchMemoryInput } from "./search-input";
import { DEFAULT_RRF_K, reciprocalRankFusion } from "./rrf";
import type {
  MemorySearchResult,
  RepositoryMemory,
  SearchMemoryInput,
} from "./types";

export const DEFAULT_DENSE_CANDIDATE_LIMIT = DEFAULT_BRANCH_CANDIDATE_LIMIT;
export const DEFAULT_LEXICAL_CANDIDATE_LIMIT = DEFAULT_BRANCH_CANDIDATE_LIMIT;
export const DEFAULT_STRUCTURED_CANDIDATE_LIMIT =
  DEFAULT_BRANCH_CANDIDATE_LIMIT;

export interface HybridRepositoryMemoryOptions {
  denseCandidateLimit?: number;
  lexicalCandidateLimit?: number;
  structuredCandidateLimit?: number;
  fusionBranchCandidateLimit?: number;
  maxCandidatesPerPath?: number;
  rrfK?: number;
}

export class HybridRepositoryMemory implements RepositoryMemory {
  private readonly denseCandidateLimit: number;
  private readonly lexicalCandidateLimit: number;
  private readonly structuredCandidateLimit: number;
  private readonly fusionBranchCandidateLimit: number;
  private readonly maxCandidatesPerPath: number;
  private readonly rrfK: number;

  constructor(
    private readonly dense: RepositoryMemory,
    private readonly lexical: RepositoryMemory,
    private readonly structured: RepositoryMemory,
    options: HybridRepositoryMemoryOptions = {},
  ) {
    this.denseCandidateLimit = validateBranchCandidateLimit(
      options.denseCandidateLimit ?? DEFAULT_DENSE_CANDIDATE_LIMIT,
      "Dense",
    );
    this.lexicalCandidateLimit = validateBranchCandidateLimit(
      options.lexicalCandidateLimit ?? DEFAULT_LEXICAL_CANDIDATE_LIMIT,
      "Lexical",
    );
    this.structuredCandidateLimit = validateBranchCandidateLimit(
      options.structuredCandidateLimit ?? DEFAULT_STRUCTURED_CANDIDATE_LIMIT,
      "Structured",
    );
    this.fusionBranchCandidateLimit = validateCandidateLimit(
      options.fusionBranchCandidateLimit ??
        DEFAULT_FUSION_BRANCH_CANDIDATE_LIMIT,
      "Fusion branch",
    );
    this.maxCandidatesPerPath = validateCandidateLimit(
      options.maxCandidatesPerPath ?? DEFAULT_MAX_CANDIDATES_PER_PATH,
      "Per-path",
    );
    this.rrfK = options.rrfK ?? DEFAULT_RRF_K;
    if (!Number.isFinite(this.rrfK) || this.rrfK < 0) {
      throw new Error("RRF k must be a non-negative finite number");
    }
  }

  async searchMemory(
    input: SearchMemoryInput,
  ): Promise<readonly MemorySearchResult[]> {
    const normalized = normalizeSearchMemoryInput(input);
    const sharedInput = {
      repositoryId: normalized.repositoryId,
      query: normalized.query,
      before: normalized.before,
    };
    const [denseResults, lexicalResults, structuredResults] = await Promise.all(
      [
        this.dense.searchMemory({
          ...sharedInput,
          limit: Math.max(normalized.limit, this.denseCandidateLimit),
        }),
        this.lexical.searchMemory({
          ...sharedInput,
          limit: Math.max(normalized.limit, this.lexicalCandidateLimit),
        }),
        this.structured.searchMemory({
          ...sharedInput,
          limit: Math.max(normalized.limit, this.structuredCandidateLimit),
        }),
      ],
    );

    const branchDiversification = {
      limit: Math.max(normalized.limit, this.fusionBranchCandidateLimit),
      maxCandidatesPerPath: this.maxCandidatesPerPath,
    };
    const diversifiedDense = diversifyCandidatesByPath(
      denseResults,
      branchDiversification,
    );
    const diversifiedLexical = diversifyCandidatesByPath(
      lexicalResults,
      branchDiversification,
    );
    const diversifiedStructured = diversifyCandidatesByPath(
      structuredResults,
      branchDiversification,
    );
    const fused = reciprocalRankFusion(
      diversifiedDense,
      diversifiedLexical,
      {
        limit:
          diversifiedDense.length +
          diversifiedLexical.length +
          diversifiedStructured.length,
        k: this.rrfK,
      },
      diversifiedStructured,
    );
    return diversifyCandidatesByPath(fused, {
      limit: normalized.limit,
      maxCandidatesPerPath: this.maxCandidatesPerPath,
    });
  }
}
