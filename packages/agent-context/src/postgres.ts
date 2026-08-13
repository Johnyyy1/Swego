import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { repositories, type Database } from "@swega/db";
import type { EmbeddingProvider } from "@swega/embeddings";

import type { AgentRepository, AgentRepositoryStore } from "./types";

interface RepositoryRow {
  repositoryId: string;
  owner: string;
  repositoryName: string;
  provider: string;
  url: string;
  defaultBranch: string | null;
  revision: string | null;
  ready: boolean;
  indexedAt: Date | null;
  gitIndexedAt: Date | null;
  memoryIndexedAt: Date | null;
  earliestAvailableAt: Date | null;
  latestAvailableAt: Date | null;
}

export class PgAgentRepositoryStore implements AgentRepositoryStore {
  constructor(
    private readonly database: Database,
    private readonly embeddings: Pick<
      EmbeddingProvider,
      "provider" | "model" | "dimensions"
    >,
  ) {}

  async listRepositories(): Promise<readonly AgentRepository[]> {
    const rows = await this.repositoryQuery()
      .where(isNull(repositories.deletedAt))
      .orderBy(
        asc(repositories.provider),
        asc(repositories.owner),
        asc(repositories.name),
        asc(repositories.id),
      );
    return rows.map(toAgentRepository);
  }

  async getRepository(repositoryId: string): Promise<AgentRepository | null> {
    const rows = await this.repositoryQuery()
      .where(
        and(isNull(repositories.deletedAt), eq(repositories.id, repositoryId)),
      )
      .limit(1);
    return rows[0] ? toAgentRepository(rows[0]) : null;
  }

  private repositoryQuery() {
    return this.database
      .select({
        repositoryId: repositories.id,
        owner: repositories.owner,
        repositoryName: repositories.name,
        provider: repositories.provider,
        url: repositories.url,
        defaultBranch: repositories.defaultBranch,
        revision: sql<string | null>`(
          select "repository_files"."last_known_commit_sha"
          from "repository_files"
          where "repository_files"."repository_id" = "repositories"."id"
          order by "repository_files"."last_synced_at" desc, "repository_files"."path" asc
          limit 1
        )`,
        ready: sql<boolean>`exists (
          select 1
          from "document_chunks"
          inner join "chunk_embeddings"
            on "chunk_embeddings"."repository_id" = "document_chunks"."repository_id"
            and "chunk_embeddings"."chunk_id" = "document_chunks"."id"
          where "document_chunks"."repository_id" = "repositories"."id"
            and "document_chunks"."superseded_at" is null
            and "chunk_embeddings"."provider" = ${this.embeddings.provider}
            and "chunk_embeddings"."model" = ${this.embeddings.model}
            and "chunk_embeddings"."dimensions" = ${this.embeddings.dimensions}
        )`,
        indexedAt: repositories.indexedAt,
        gitIndexedAt: repositories.gitIndexedAt,
        memoryIndexedAt: sql<Date | null>`(
          select max("document_chunks"."indexed_at")
          from "document_chunks"
          where "document_chunks"."repository_id" = "repositories"."id"
        )`,
        earliestAvailableAt: sql<Date | null>`(
          select min("document_chunks"."available_at")
          from "document_chunks"
          where "document_chunks"."repository_id" = "repositories"."id"
        )`,
        latestAvailableAt: sql<Date | null>`(
          select max("document_chunks"."available_at")
          from "document_chunks"
          where "document_chunks"."repository_id" = "repositories"."id"
        )`,
      })
      .from(repositories)
      .$dynamic();
  }
}

function toAgentRepository(row: RepositoryRow): AgentRepository {
  const memoryIndexedAt = toNullableDate(row.memoryIndexedAt);
  const earliestAvailableAt = toNullableDate(row.earliestAvailableAt);
  const latestAvailableAt = toNullableDate(row.latestAvailableAt);

  return {
    repositoryId: row.repositoryId,
    name: `${row.owner}/${row.repositoryName}`,
    owner: row.owner,
    repositoryName: row.repositoryName,
    provider: row.provider,
    url: row.url,
    defaultBranch: row.defaultBranch,
    revision: row.revision,
    memoryStatus: row.ready ? "ready" : "not_ready",
    ready: row.ready,
    indexedAt: row.indexedAt,
    gitIndexedAt: row.gitIndexedAt,
    memoryIndexedAt,
    temporalCoverage:
      earliestAvailableAt && latestAvailableAt
        ? {
            earliestAvailableAt,
            latestAvailableAt,
          }
        : null,
  };
}

function toNullableDate(value: Date | string | null): Date | null {
  return value === null || value instanceof Date ? value : new Date(value);
}
