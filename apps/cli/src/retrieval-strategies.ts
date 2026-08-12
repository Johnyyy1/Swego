import type { Database } from "@swega/db";
import type { EmbeddingProvider } from "@swega/embeddings";
import type { Reranker } from "@swega/reranking";
import {
  HybridRepositoryMemory,
  PgLexicalRepositoryMemory,
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

export function createConfiguredRetrievalStrategies(
  database: Database,
  embeddings: EmbeddingProvider,
  reranker?: Reranker,
): ConfiguredRetrievalStrategies {
  const dense = new PgVectorRepositoryMemory(database, embeddings);
  const lexical = new PgLexicalRepositoryMemory(database);
  const hybrid = new HybridRepositoryMemory(dense, lexical);
  return {
    dense,
    lexical,
    hybrid,
    ...(reranker
      ? { hybridReranked: new RerankedRepositoryMemory(hybrid, reranker) }
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
