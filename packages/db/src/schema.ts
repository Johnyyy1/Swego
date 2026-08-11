import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
