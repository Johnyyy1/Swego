import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

import { EMBEDDING_DIMENSIONS, type MemorySourceType } from "@swega/shared";

export const issueStates = ["open", "closed"] as const;
export type IssueState = (typeof issueStates)[number];

export const pullRequestStates = ["open", "closed", "merged"] as const;
export type PullRequestState = (typeof pullRequestStates)[number];

export const pullRequestFileStatuses = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "changed",
  "unchanged",
] as const;
export type PullRequestFileStatus = (typeof pullRequestFileStatuses)[number];

export const reviewStates = [
  "pending",
  "approved",
  "changes_requested",
  "commented",
  "dismissed",
] as const;
export type ReviewState = (typeof reviewStates)[number];

export const repositories = pgTable(
  "repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerId: text("provider_id"),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    defaultBranch: text("default_branch"),
    createdAt: timestamp("created_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    indexedAt: timestamp("indexed_at", { withTimezone: true }),
    gitIndexedAt: timestamp("git_indexed_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("repositories_provider_provider_id_unique")
      .on(table.provider, table.providerId)
      .where(sql`${table.providerId} is not null`),
    uniqueIndex("repositories_provider_owner_name_unique").on(
      table.provider,
      table.owner,
      table.name,
    ),
    index("repositories_url_index").on(table.url),
    index("repositories_indexed_at_index").on(table.indexedAt),
    index("repositories_git_indexed_at_index").on(table.gitIndexedAt),
  ],
);

export const commits = pgTable(
  "commits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    sha: text("sha").notNull(),
    message: text("message").notNull(),
    author: text("author").notNull(),
    authorEmail: text("author_email"),
    authoredAt: timestamp("authored_at", { withTimezone: true }).notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("commits_repository_sha_unique").on(
      table.repositoryId,
      table.sha,
    ),
    index("commits_repository_authored_at_index").on(
      table.repositoryId,
      table.authoredAt,
    ),
    index("commits_repository_committed_at_index").on(
      table.repositoryId,
      table.committedAt,
    ),
  ],
);

export const repositoryFiles = pgTable(
  "repository_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    language: text("language"),
    extension: text("extension"),
    size: bigint("size", { mode: "number" }).notNull(),
    lastKnownCommitSha: text("last_known_commit_sha").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("repository_files_repository_path_unique").on(
      table.repositoryId,
      table.path,
    ),
    index("repository_files_repository_language_index").on(
      table.repositoryId,
      table.language,
    ),
    index("repository_files_repository_extension_index").on(
      table.repositoryId,
      table.extension,
    ),
    index("repository_files_repository_commit_sha_index").on(
      table.repositoryId,
      table.lastKnownCommitSha,
    ),
    check("repository_files_size_check", sql`${table.size} >= 0`),
  ],
);

export const issues = pgTable(
  "issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    number: integer("number"),
    title: text("title").notNull(),
    body: text("body"),
    state: text("state").$type<IssueState>().notNull(),
    author: text("author"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("issues_repository_id_id_unique").on(
      table.repositoryId,
      table.id,
    ),
    uniqueIndex("issues_repository_provider_id_unique").on(
      table.repositoryId,
      table.providerId,
    ),
    uniqueIndex("issues_repository_number_unique")
      .on(table.repositoryId, table.number)
      .where(sql`${table.number} is not null`),
    index("issues_repository_created_at_index").on(
      table.repositoryId,
      table.createdAt,
    ),
    index("issues_repository_source_updated_at_index").on(
      table.repositoryId,
      table.sourceUpdatedAt,
    ),
    index("issues_repository_state_index").on(table.repositoryId, table.state),
    check("issues_state_check", sql`${table.state} in ('open', 'closed')`),
  ],
);

export const issueComments = pgTable(
  "issue_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id").notNull(),
    issueId: uuid("issue_id").notNull(),
    providerId: text("provider_id").notNull(),
    body: text("body"),
    author: text("author"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.repositoryId, table.issueId],
      foreignColumns: [issues.repositoryId, issues.id],
      name: "issue_comments_repository_issue_foreign_key",
    }).onDelete("cascade"),
    uniqueIndex("issue_comments_repository_provider_id_unique").on(
      table.repositoryId,
      table.providerId,
    ),
    index("issue_comments_repository_issue_created_at_index").on(
      table.repositoryId,
      table.issueId,
      table.createdAt,
    ),
    index("issue_comments_repository_created_at_index").on(
      table.repositoryId,
      table.createdAt,
    ),
    index("issue_comments_repository_source_updated_at_index").on(
      table.repositoryId,
      table.sourceUpdatedAt,
    ),
  ],
);

export const pullRequests = pgTable(
  "pull_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    number: integer("number"),
    title: text("title").notNull(),
    body: text("body"),
    state: text("state").$type<PullRequestState>().notNull(),
    author: text("author"),
    baseBranch: text("base_branch").notNull(),
    headBranch: text("head_branch").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("pull_requests_repository_id_id_unique").on(
      table.repositoryId,
      table.id,
    ),
    uniqueIndex("pull_requests_repository_provider_id_unique").on(
      table.repositoryId,
      table.providerId,
    ),
    uniqueIndex("pull_requests_repository_number_unique")
      .on(table.repositoryId, table.number)
      .where(sql`${table.number} is not null`),
    index("pull_requests_repository_created_at_index").on(
      table.repositoryId,
      table.createdAt,
    ),
    index("pull_requests_repository_source_updated_at_index").on(
      table.repositoryId,
      table.sourceUpdatedAt,
    ),
    index("pull_requests_repository_state_index").on(
      table.repositoryId,
      table.state,
    ),
    check(
      "pull_requests_state_check",
      sql`${table.state} in ('open', 'closed', 'merged')`,
    ),
    check(
      "pull_requests_merged_at_check",
      sql`${table.mergedAt} is null or ${table.state} = 'merged'`,
    ),
  ],
);

export const pullRequestFiles = pgTable(
  "pull_request_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id").notNull(),
    pullRequestId: uuid("pull_request_id").notNull(),
    path: text("path").notNull(),
    status: text("status").$type<PullRequestFileStatus>().notNull(),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.repositoryId, table.pullRequestId],
      foreignColumns: [pullRequests.repositoryId, pullRequests.id],
      name: "pull_request_files_repository_pull_request_foreign_key",
    }).onDelete("cascade"),
    uniqueIndex("pull_request_files_repository_pull_request_path_unique").on(
      table.repositoryId,
      table.pullRequestId,
      table.path,
    ),
    check(
      "pull_request_files_status_check",
      sql`${table.status} in ('added', 'modified', 'deleted', 'renamed', 'copied', 'changed', 'unchanged')`,
    ),
    check("pull_request_files_additions_check", sql`${table.additions} >= 0`),
    check("pull_request_files_deletions_check", sql`${table.deletions} >= 0`),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id").notNull(),
    pullRequestId: uuid("pull_request_id").notNull(),
    providerId: text("provider_id").notNull(),
    body: text("body"),
    author: text("author"),
    state: text("state").$type<ReviewState>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.repositoryId, table.pullRequestId],
      foreignColumns: [pullRequests.repositoryId, pullRequests.id],
      name: "reviews_repository_pull_request_foreign_key",
    }).onDelete("cascade"),
    uniqueIndex("reviews_repository_provider_id_unique").on(
      table.repositoryId,
      table.providerId,
    ),
    index("reviews_repository_pull_request_created_at_index").on(
      table.repositoryId,
      table.pullRequestId,
      table.createdAt,
    ),
    index("reviews_repository_created_at_index").on(
      table.repositoryId,
      table.createdAt,
    ),
    index("reviews_repository_source_updated_at_index").on(
      table.repositoryId,
      table.sourceUpdatedAt,
    ),
    check(
      "reviews_state_check",
      sql`${table.state} in ('pending', 'approved', 'changes_requested', 'commented', 'dismissed')`,
    ),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    sourceType: text("source_type").$type<MemorySourceType>().notNull(),
    sourceEntityId: uuid("source_entity_id").notNull(),
    parentSourceType: text("parent_source_type").$type<MemorySourceType>(),
    parentSourceEntityId: uuid("parent_source_entity_id"),
    sourceVersion: text("source_version").notNull(),
    sourceReference: text("source_reference").notNull(),
    title: text("title"),
    contentHash: text("content_hash").notNull(),
    chunkingStrategy: text("chunking_strategy").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    path: text("path"),
    commitSha: text("commit_sha"),
    indexedAt: timestamp("indexed_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique("documents_repository_id_id_unique").on(
      table.repositoryId,
      table.id,
    ),
    uniqueIndex("documents_repository_source_version_unique").on(
      table.repositoryId,
      table.sourceType,
      table.sourceEntityId,
      table.sourceVersion,
    ),
    index("documents_repository_available_at_index").on(
      table.repositoryId,
      table.availableAt,
      table.supersededAt,
    ),
    index("documents_repository_source_type_index").on(
      table.repositoryId,
      table.sourceType,
    ),
    index("documents_repository_parent_source_index").on(
      table.repositoryId,
      table.parentSourceType,
      table.parentSourceEntityId,
    ),
    index("documents_repository_path_index").on(table.repositoryId, table.path),
    index("documents_repository_commit_sha_index").on(
      table.repositoryId,
      table.commitSha,
    ),
    check(
      "documents_source_type_check",
      sql`${table.sourceType} in ('issue', 'issue_comment', 'pull_request', 'review', 'commit', 'source_code')`,
    ),
    check(
      "documents_temporal_range_check",
      sql`${table.supersededAt} is null or ${table.supersededAt} >= ${table.availableAt}`,
    ),
    check(
      "documents_source_code_provenance_check",
      sql`${table.sourceType} <> 'source_code' or (${table.path} is not null and ${table.commitSha} is not null)`,
    ),
    check(
      "documents_commit_provenance_check",
      sql`${table.sourceType} <> 'commit' or ${table.commitSha} is not null`,
    ),
    check(
      "documents_parent_source_check",
      sql`(${table.parentSourceType} is null and ${table.parentSourceEntityId} is null) or (${table.parentSourceType} is not null and ${table.parentSourceEntityId} is not null)`,
    ),
    check(
      "documents_parent_source_type_check",
      sql`${table.parentSourceType} is null or ${table.parentSourceType} in ('issue', 'pull_request')`,
    ),
  ],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull(),
    repositoryId: uuid("repository_id").notNull(),
    sourceType: text("source_type").$type<MemorySourceType>().notNull(),
    sourceEntityId: uuid("source_entity_id").notNull(),
    parentSourceType: text("parent_source_type").$type<MemorySourceType>(),
    parentSourceEntityId: uuid("parent_source_entity_id"),
    sourceReference: text("source_reference").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    path: text("path"),
    commitSha: text("commit_sha"),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    indexedAt: timestamp("indexed_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      columns: [table.repositoryId, table.documentId],
      foreignColumns: [documents.repositoryId, documents.id],
      name: "document_chunks_repository_document_foreign_key",
    }).onDelete("cascade"),
    uniqueIndex("document_chunks_repository_document_index_unique").on(
      table.repositoryId,
      table.documentId,
      table.chunkIndex,
    ),
    unique("document_chunks_repository_id_unique").on(
      table.repositoryId,
      table.id,
    ),
    index("document_chunks_repository_available_at_index").on(
      table.repositoryId,
      table.availableAt,
      table.supersededAt,
    ),
    index("document_chunks_repository_source_type_index").on(
      table.repositoryId,
      table.sourceType,
    ),
    index("document_chunks_repository_parent_source_index").on(
      table.repositoryId,
      table.parentSourceType,
      table.parentSourceEntityId,
    ),
    index("document_chunks_repository_path_index").on(
      table.repositoryId,
      table.path,
    ),
    index("document_chunks_repository_commit_sha_index").on(
      table.repositoryId,
      table.commitSha,
    ),
    check(
      "document_chunks_source_type_check",
      sql`${table.sourceType} in ('issue', 'issue_comment', 'pull_request', 'review', 'commit', 'source_code')`,
    ),
    check("document_chunks_chunk_index_check", sql`${table.chunkIndex} >= 0`),
    check(
      "document_chunks_temporal_range_check",
      sql`${table.supersededAt} is null or ${table.supersededAt} >= ${table.availableAt}`,
    ),
    check(
      "document_chunks_line_range_check",
      sql`(${table.startLine} is null and ${table.endLine} is null) or (${table.startLine} >= 1 and ${table.endLine} >= ${table.startLine})`,
    ),
    check(
      "document_chunks_source_code_provenance_check",
      sql`${table.sourceType} <> 'source_code' or (${table.path} is not null and ${table.commitSha} is not null)`,
    ),
    check(
      "document_chunks_parent_source_check",
      sql`(${table.parentSourceType} is null and ${table.parentSourceEntityId} is null) or (${table.parentSourceType} is not null and ${table.parentSourceEntityId} is not null)`,
    ),
    check(
      "document_chunks_parent_source_type_check",
      sql`${table.parentSourceType} is null or ${table.parentSourceType} in ('issue', 'pull_request')`,
    ),
  ],
);

export const chunkEmbeddings = pgTable(
  "chunk_embeddings",
  {
    chunkId: text("chunk_id").notNull(),
    repositoryId: uuid("repository_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    dimensions: integer("dimensions").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: vector("embedding", {
      dimensions: EMBEDDING_DIMENSIONS,
    }).notNull(),
    embeddedAt: timestamp("embedded_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    primaryKey({
      columns: [table.repositoryId, table.chunkId],
      name: "chunk_embeddings_repository_chunk_primary_key",
    }),
    foreignKey({
      columns: [table.repositoryId, table.chunkId],
      foreignColumns: [documentChunks.repositoryId, documentChunks.id],
      name: "chunk_embeddings_repository_chunk_foreign_key",
    }).onDelete("cascade"),
    index("chunk_embeddings_repository_provider_model_index").on(
      table.repositoryId,
      table.provider,
      table.model,
    ),
    index("chunk_embeddings_embedding_hnsw_index").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    check(
      "chunk_embeddings_dimensions_check",
      sql`${table.dimensions} = ${sql.raw(String(EMBEDDING_DIMENSIONS))}`,
    ),
  ],
);

export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;
export type Commit = typeof commits.$inferSelect;
export type NewCommit = typeof commits.$inferInsert;
export type RepositoryFile = typeof repositoryFiles.$inferSelect;
export type NewRepositoryFile = typeof repositoryFiles.$inferInsert;
export type Issue = typeof issues.$inferSelect;
export type NewIssue = typeof issues.$inferInsert;
export type IssueComment = typeof issueComments.$inferSelect;
export type NewIssueComment = typeof issueComments.$inferInsert;
export type PullRequest = typeof pullRequests.$inferSelect;
export type NewPullRequest = typeof pullRequests.$inferInsert;
export type PullRequestFile = typeof pullRequestFiles.$inferSelect;
export type NewPullRequestFile = typeof pullRequestFiles.$inferInsert;
export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type NewDocumentChunk = typeof documentChunks.$inferInsert;
export type ChunkEmbedding = typeof chunkEmbeddings.$inferSelect;
export type NewChunkEmbedding = typeof chunkEmbeddings.$inferInsert;
