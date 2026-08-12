export {
  EmbeddingCompatibilityError,
  PgVectorRepositoryMemory,
} from "./postgres";
export {
  DEFAULT_DENSE_CANDIDATE_LIMIT,
  DEFAULT_LEXICAL_CANDIDATE_LIMIT,
  DEFAULT_STRUCTURED_CANDIDATE_LIMIT,
  HybridRepositoryMemory,
} from "./hybrid";
export type { HybridRepositoryMemoryOptions } from "./hybrid";
export { PgLexicalRepositoryMemory } from "./lexical";
export {
  DEFAULT_BRANCH_CANDIDATE_LIMIT,
  DEFAULT_CANDIDATE_GENERATION_CONFIG,
  DEFAULT_CANDIDATE_POOL_LIMIT,
  DEFAULT_FUSION_BRANCH_CANDIDATE_LIMIT,
  DEFAULT_MAX_CANDIDATES_PER_PATH,
} from "./candidate-generation";
export type { CandidateGenerationConfig } from "./candidate-generation";
export { diversifyCandidatesByPath } from "./diversify";
export {
  normalizeStructuralQuery,
  PgStructuredRepositoryMemory,
  structuralQueryTerms,
} from "./structured";
export {
  DEFAULT_RERANK_CANDIDATE_LIMIT,
  RerankedRepositoryMemory,
} from "./reranked";
export type { RerankedRepositoryMemoryOptions } from "./reranked";
export { DEFAULT_RRF_K, reciprocalRankFusion } from "./rrf";
export type { ReciprocalRankFusionOptions } from "./rrf";
export type {
  DiagnosticRepositoryMemory,
  MemorySearchResult,
  MemorySourceMetadata,
  RepositoryMemory,
  SearchMemoryExecution,
  SearchMemoryExecutionDiagnostics,
  SearchMemoryInput,
} from "./types";
export { supportsSearchMemoryDiagnostics } from "./types";
