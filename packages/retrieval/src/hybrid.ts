import { MAX_SEARCH_LIMIT, normalizeSearchMemoryInput } from "./search-input";
import { DEFAULT_RRF_K, reciprocalRankFusion } from "./rrf";
import type {
  MemorySearchResult,
  RepositoryMemory,
  SearchMemoryInput,
} from "./types";

export const DEFAULT_DENSE_CANDIDATE_LIMIT = 30;
export const DEFAULT_LEXICAL_CANDIDATE_LIMIT = 30;

export interface HybridRepositoryMemoryOptions {
  denseCandidateLimit?: number;
  lexicalCandidateLimit?: number;
  rrfK?: number;
}

export class HybridRepositoryMemory implements RepositoryMemory {
  private readonly denseCandidateLimit: number;
  private readonly lexicalCandidateLimit: number;
  private readonly rrfK: number;

  constructor(
    private readonly dense: RepositoryMemory,
    private readonly lexical: RepositoryMemory,
    options: HybridRepositoryMemoryOptions = {},
  ) {
    this.denseCandidateLimit = validateCandidateLimit(
      options.denseCandidateLimit ?? DEFAULT_DENSE_CANDIDATE_LIMIT,
      "Dense",
    );
    this.lexicalCandidateLimit = validateCandidateLimit(
      options.lexicalCandidateLimit ?? DEFAULT_LEXICAL_CANDIDATE_LIMIT,
      "Lexical",
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
    const [denseResults, lexicalResults] = await Promise.all([
      this.dense.searchMemory({
        ...sharedInput,
        limit: Math.max(normalized.limit, this.denseCandidateLimit),
      }),
      this.lexical.searchMemory({
        ...sharedInput,
        limit: Math.max(normalized.limit, this.lexicalCandidateLimit),
      }),
    ]);

    return reciprocalRankFusion(denseResults, lexicalResults, {
      limit: normalized.limit,
      k: this.rrfK,
    });
  }
}

function validateCandidateLimit(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_SEARCH_LIMIT) {
    throw new Error(
      `${label} candidate limit must be between 1 and ${MAX_SEARCH_LIMIT}`,
    );
  }
  return value;
}
