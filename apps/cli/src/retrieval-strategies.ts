import type { Database } from "@swega/db";
import type { EmbeddingProvider } from "@swega/embeddings";
import type { Reranker } from "@swega/reranking";
import {
  DEFAULT_RERANK_FILE_EVIDENCE_STRATEGY,
  HybridRepositoryMemory,
  PgLexicalRepositoryMemory,
  PgStructuredRepositoryMemory,
  PgVectorRepositoryMemory,
  RerankedRepositoryMemory,
  type RepositoryMemory,
  type FileEvidenceStrategy,
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
  const sharedHybridOptions = {
    ...(configuration.maxCandidatesPerPath === undefined
      ? {}
      : { maxCandidatesPerPath: configuration.maxCandidatesPerPath }),
  };
  const hybrid = new HybridRepositoryMemory(dense, lexical, structured, {
    ...sharedHybridOptions,
    fileEvidenceStrategy: resolveFileEvidenceStrategy(
      configuration.fileEvidenceStrategy,
      false,
    ),
  });
  const rerankHybrid = reranker
    ? new HybridRepositoryMemory(dense, lexical, structured, {
        ...sharedHybridOptions,
        fileEvidenceStrategy: resolveFileEvidenceStrategy(
          configuration.fileEvidenceStrategy,
          true,
        ),
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
