import type { Database } from "@swega/db";
import type { EmbeddingProvider } from "@swega/embeddings";
import type { Reranker } from "@swega/reranking";
import {
  DEFAULT_RERANK_FILE_EVIDENCE_STRATEGY,
  EvidencePackBuilder,
  HybridRepositoryMemory,
  PgContextEvidenceSource,
  PgLexicalRepositoryMemory,
  PgRelationshipExpansion,
  PgStructuredRepositoryMemory,
  PgVectorRepositoryMemory,
  RerankedRepositoryMemory,
  type FileEvidenceStrategy,
  type IntentRolePriorStrategy,
} from "@swega/retrieval";

import { PgAgentRepositoryStore } from "./postgres";
import { AgentContextService } from "./service";

export interface PgAgentContextServiceOptions {
  database: Database;
  embeddings: EmbeddingProvider;
  reranker?: Reranker;
  contextRelationships?: "bounded" | "none";
  retrieval?: {
    candidateLimit?: number;
    maxCandidatesPerPath?: number;
    fileEvidenceStrategy?: FileEvidenceStrategy;
    intentRolePriorStrategy?: IntentRolePriorStrategy;
  };
}

export function createPgAgentContextService(
  options: PgAgentContextServiceOptions,
): AgentContextService {
  const evidenceSource = new PgContextEvidenceSource(options.database);
  const relationships =
    options.contextRelationships === "none"
      ? undefined
      : new PgRelationshipExpansion(options.database);
  const sharedHybridOptions = {
    ...(options.retrieval?.maxCandidatesPerPath === undefined
      ? {}
      : {
          maxCandidatesPerPath: options.retrieval.maxCandidatesPerPath,
        }),
    ...(options.retrieval?.intentRolePriorStrategy === undefined
      ? {}
      : {
          intentRolePriorStrategy: options.retrieval.intentRolePriorStrategy,
        }),
  };

  const createHybrid = (reranked: boolean) => {
    const dense = new PgVectorRepositoryMemory(
      options.database,
      options.embeddings,
    );
    return new HybridRepositoryMemory(
      dense,
      new PgLexicalRepositoryMemory(options.database),
      new PgStructuredRepositoryMemory(options.database),
      {
        ...sharedHybridOptions,
        fileEvidenceStrategy:
          options.retrieval?.fileEvidenceStrategy ??
          (reranked ? DEFAULT_RERANK_FILE_EVIDENCE_STRATEGY : "none"),
      },
    );
  };

  const contextBuilder = new EvidencePackBuilder(
    createHybrid(false),
    evidenceSource,
    relationships,
  );
  const rerankedContextBuilder = options.reranker
    ? new EvidencePackBuilder(
        new RerankedRepositoryMemory(createHybrid(true), options.reranker, {
          ...(options.retrieval?.candidateLimit === undefined
            ? {}
            : { candidateLimit: options.retrieval.candidateLimit }),
        }),
        evidenceSource,
        relationships,
      )
    : undefined;

  return new AgentContextService({
    repositories: new PgAgentRepositoryStore(
      options.database,
      options.embeddings,
    ),
    contextBuilder,
    ...(rerankedContextBuilder ? { rerankedContextBuilder } : {}),
  });
}
