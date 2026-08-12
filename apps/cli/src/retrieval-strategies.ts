import type { Database } from "@swega/db";
import type { EmbeddingProvider } from "@swega/embeddings";
import {
  HybridRepositoryMemory,
  PgLexicalRepositoryMemory,
  PgVectorRepositoryMemory,
  type RepositoryMemory,
} from "@swega/retrieval";

export interface ConfiguredRetrievalStrategies {
  dense: RepositoryMemory;
  lexical: RepositoryMemory;
  hybrid: RepositoryMemory;
}

export function createConfiguredRetrievalStrategies(
  database: Database,
  embeddings: EmbeddingProvider,
): ConfiguredRetrievalStrategies {
  const dense = new PgVectorRepositoryMemory(database, embeddings);
  const lexical = new PgLexicalRepositoryMemory(database);
  const hybrid = new HybridRepositoryMemory(dense, lexical);
  return { dense, lexical, hybrid };
}
