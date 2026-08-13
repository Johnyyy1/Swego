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
export {
  buildFileEvidenceRepresentatives,
  DEFAULT_BOUNDED_FILE_CHUNK_COUNT,
  DEFAULT_FILE_EVIDENCE_FILE_LIMIT,
  DEFAULT_RERANK_FILE_EVIDENCE_STRATEGY,
  DEFAULT_REPRESENTATIVE_CHUNKS_PER_FILE,
} from "./file-evidence";
export type { FileEvidenceOptions } from "./file-evidence";
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
export { analyzeQueryIntent, queryIntents } from "./query-intent";
export type { QueryIntent, QueryIntentSignal } from "./query-intent";
export {
  classifySourceRole,
  classifySourceRoleMetadata,
  sourceRoles,
} from "./source-role";
export type {
  SourceRole,
  SourceRoleClassification,
  SourceRoleInput,
} from "./source-role";
export {
  applyIntentRolePrior,
  DEFAULT_INTENT_ROLE_PRIOR_STRATEGY,
  INTENT_ROLE_PRIOR_WEIGHTS,
  MIN_INTENT_ROLE_BRANCH_COMPATIBILITY,
  intentRolePriorStrategies,
} from "./intent-role";
export type {
  IntentRolePriorOptions,
  IntentRolePriorStrategy,
} from "./intent-role";
export {
  DEFAULT_RELATIONSHIP_CANDIDATE_LIMIT,
  DEFAULT_RELATIONSHIP_MAX_ANCHORS,
  DEFAULT_RELATIONSHIP_MAX_NEIGHBORS_PER_ANCHOR,
  DEFAULT_RELATIONSHIP_RESERVED_CANDIDATES,
  selectCandidatesWithRelationshipReserve,
  selectRelationshipAnchors,
} from "./relationship-expansion";
export type {
  RelationshipExpansion,
  RelationshipExpansionInput,
} from "./relationship-expansion";
export {
  PgRelationshipExpansion,
  selectRepresentativeRelationshipChunk,
} from "./relationship-postgres";
export type { RelationshipRepresentativeChunk } from "./relationship-postgres";
export type {
  DiagnosticRepositoryMemory,
  FileEvidenceSource,
  FileEvidenceStrategy,
  MemorySearchResult,
  MemorySourceMetadata,
  RepositoryMemory,
  SearchMemoryExecution,
  SearchMemoryExecutionDiagnostics,
  SearchMemoryInput,
  RepresentativeChunkReason,
  RetrievalRelationshipType,
  RelationshipExpansionStrategy,
} from "./types";
export {
  fileEvidenceStrategies,
  relationshipExpansionStrategies,
} from "./types";
export { supportsSearchMemoryDiagnostics } from "./types";
