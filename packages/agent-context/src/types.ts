import type { EvidencePack } from "@swega/retrieval";

export const repositoryMemoryStatuses = ["ready", "not_ready"] as const;

export type RepositoryMemoryStatus = (typeof repositoryMemoryStatuses)[number];

export interface AgentRepositoryTemporalCoverage {
  earliestAvailableAt: Date;
  latestAvailableAt: Date;
}

export interface AgentRepository {
  repositoryId: string;
  name: string;
  owner: string;
  repositoryName: string;
  provider: string;
  url: string;
  defaultBranch: string | null;
  revision: string | null;
  memoryStatus: RepositoryMemoryStatus;
  ready: boolean;
  indexedAt: Date | null;
  gitIndexedAt: Date | null;
  memoryIndexedAt: Date | null;
  temporalCoverage: AgentRepositoryTemporalCoverage | null;
}

export interface AgentRepositoryStore {
  listRepositories(): Promise<readonly AgentRepository[]>;
  getRepository(repositoryId: string): Promise<AgentRepository | null>;
}

export interface AgentContextRequest {
  repositoryId: string;
  query: string;
  before?: Date;
  contextBudget?: number;
  rerank?: boolean;
}

/** Delivery-adapter controls that are intentionally absent from MCP v1. */
export interface AgentContextBuildOptions {
  primaryEvidenceLimit?: number;
  debug?: boolean;
}

export type AgentContextResponse = EvidencePack;

export interface EvidencePackBuilderPort {
  build(input: {
    repositoryId: string;
    query: string;
    before?: Date;
    contextBudget?: number;
    limit?: number;
    debug?: boolean;
  }): Promise<EvidencePack>;
}
