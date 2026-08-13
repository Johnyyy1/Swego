import type { Database } from "@swega/db";
import type { EmbeddingProvider } from "@swega/embeddings";
import type { Reranker } from "@swega/reranking";
import {
  DEFAULT_RERANK_FILE_EVIDENCE_STRATEGY,
  HybridRepositoryMemory,
  PgLexicalRepositoryMemory,
  PgStructuredRepositoryMemory,
  PgVectorRepositoryMemory,
  PgRelationshipExpansion,
  RerankedRepositoryMemory,
  type RepositoryMemory,
  type FileEvidenceStrategy,
  type IntentRolePriorStrategy,
  type RelationshipExpansionStrategy,
} from "@swega/retrieval";

export interface ConfiguredRetrievalStrategies {
  dense: RepositoryMemory;
  lexical: RepositoryMemory;
  structured: RepositoryMemory;
  hybrid: RepositoryMemory;
  hybridReranked?: RepositoryMemory;
}

export interface RetrievalStrategyConfiguration {
  candidateLimit?: number;
  maxCandidatesPerPath?: number;
  fileEvidenceStrategy?: FileEvidenceStrategy;
  relationshipExpansionStrategy?: RelationshipExpansionStrategy;
  relationshipReservedCandidates?: number;
  intentRolePriorStrategy?: IntentRolePriorStrategy;
}

export function createConfiguredRetrievalStrategies(
  database: Database,
  embeddings: EmbeddingProvider,
  reranker?: Reranker,
  configuration: RetrievalStrategyConfiguration = {},
): ConfiguredRetrievalStrategies {
  const dense = new PgVectorRepositoryMemory(database, embeddings);
  const lexical = new PgLexicalRepositoryMemory(database);
  const structured = new PgStructuredRepositoryMemory(database);
  const relationships = new PgRelationshipExpansion(database);
  const sharedHybridOptions = {
    ...(configuration.maxCandidatesPerPath === undefined
      ? {}
      : { maxCandidatesPerPath: configuration.maxCandidatesPerPath }),
    ...(configuration.relationshipReservedCandidates === undefined
      ? {}
      : {
          relationshipReservedCandidates:
            configuration.relationshipReservedCandidates,
        }),
    ...(configuration.intentRolePriorStrategy === undefined
      ? {}
      : { intentRolePriorStrategy: configuration.intentRolePriorStrategy }),
  };
  const hybrid = new HybridRepositoryMemory(dense, lexical, structured, {
    ...sharedHybridOptions,
    fileEvidenceStrategy: resolveFileEvidenceStrategy(
      configuration.fileEvidenceStrategy,
      false,
    ),
    ...(resolveRelationshipExpansionStrategy(
      configuration.relationshipExpansionStrategy,
    ) === "bounded"
      ? { relationshipExpansion: relationships }
      : {}),
  });
  const rerankHybrid = reranker
    ? new HybridRepositoryMemory(dense, lexical, structured, {
        ...sharedHybridOptions,
        fileEvidenceStrategy: resolveFileEvidenceStrategy(
          configuration.fileEvidenceStrategy,
          true,
        ),
        ...(resolveRelationshipExpansionStrategy(
          configuration.relationshipExpansionStrategy,
        ) === "bounded"
          ? { relationshipExpansion: relationships }
          : {}),
      })
    : null;
  return {
    dense,
    lexical,
    structured,
    hybrid,
    ...(reranker
      ? {
          hybridReranked: new RerankedRepositoryMemory(
            rerankHybrid ?? hybrid,
            reranker,
            {
              ...(configuration.candidateLimit === undefined
                ? {}
                : { candidateLimit: configuration.candidateLimit }),
            },
          ),
        }
      : {}),
  };
}

export function resolveRelationshipExpansionStrategy(
  configured: RelationshipExpansionStrategy | undefined,
): RelationshipExpansionStrategy {
  return configured ?? "none";
}

export function resolveFileEvidenceStrategy(
  configured: FileEvidenceStrategy | undefined,
  reranked: boolean,
): FileEvidenceStrategy {
  return (
    configured ?? (reranked ? DEFAULT_RERANK_FILE_EVIDENCE_STRATEGY : "none")
  );
}

export function requireRerankedStrategy(
  strategies: ConfiguredRetrievalStrategies,
): RepositoryMemory {
  if (!strategies.hybridReranked) {
    throw new Error("Reranked retrieval strategy was not configured");
  }
  return strategies.hybridReranked;
}
