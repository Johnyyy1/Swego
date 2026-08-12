import type { Database } from "@swega/db";
import type { EmbeddingProvider } from "@swega/embeddings";
import type { Reranker } from "@swega/reranking";
import {
  HybridRepositoryMemory,
  PgLexicalRepositoryMemory,
  PgStructuredRepositoryMemory,
  PgVectorRepositoryMemory,
  RerankedRepositoryMemory,
  type RepositoryMemory,
} from "@swega/retrieval";

export interface ConfiguredRetrievalStrategies {
  dense: RepositoryMemory;
  lexical: RepositoryMemory;
  hybrid: RepositoryMemory;
  hybridReranked?: RepositoryMemory;
}

export interface RetrievalStrategyConfiguration {
  candidateLimit?: number;
  maxCandidatesPerPath?: number;
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
  const hybrid = new HybridRepositoryMemory(dense, lexical, structured, {
    ...(configuration.maxCandidatesPerPath === undefined
      ? {}
      : { maxCandidatesPerPath: configuration.maxCandidatesPerPath }),
  });
  return {
    dense,
    lexical,
    hybrid,
    ...(reranker
      ? {
          hybridReranked: new RerankedRepositoryMemory(hybrid, reranker, {
            ...(configuration.candidateLimit === undefined
              ? {}
              : { candidateLimit: configuration.candidateLimit }),
          }),
        }
      : {}),
  };
}

export function requireRerankedStrategy(
  strategies: ConfiguredRetrievalStrategies,
): RepositoryMemory {
  if (!strategies.hybridReranked) {
    throw new Error("Reranked retrieval strategy was not configured");
  }
  return strategies.hybridReranked;
}
