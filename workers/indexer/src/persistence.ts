import { and, eq, inArray, ne, or, sql } from "drizzle-orm";

import {
  commits,
  issueComments,
  issues,
  pullRequestFiles,
  pullRequests,
  repositories,
  repositoryFiles,
  reviews,
  type Database,
} from "@swega/db";
import type {
  NormalizedCommit,
  NormalizedIssue,
  NormalizedIssueComment,
  NormalizedPullRequest,
  NormalizedPullRequestFile,
  NormalizedRepository,
  NormalizedReview,
} from "@swega/github";
import type { GitCommit, GitTrackedFile } from "@swega/git";

function requireReturnedRow<T>(rows: readonly T[], entity: string): T {
  const row = rows[0];
  if (!row) {
    throw new Error(`Database did not return the upserted ${entity}`);
  }

  return row;
}

export async function upsertRepository(
  database: Database,
  repository: NormalizedRepository,
  syncedAt: Date,
): Promise<string> {
  const existing = await database
    .select({ id: repositories.id })
    .from(repositories)
    .where(
      and(
        eq(repositories.provider, repository.provider),
        or(
          eq(repositories.providerId, repository.providerId),
          and(
            eq(repositories.owner, repository.owner),
            eq(repositories.name, repository.name),
          ),
        ),
      ),
    )
    .limit(1);

  const values = {
    provider: repository.provider,
    providerId: repository.providerId,
    owner: repository.owner,
    name: repository.name,
    url: repository.url,
    defaultBranch: repository.defaultBranch,
    createdAt: repository.createdAt,
    sourceUpdatedAt: repository.sourceUpdatedAt,
    lastSyncedAt: syncedAt,
    deletedAt: null,
  };

  const existingRow = existing[0];
  if (existingRow) {
    const updated = await database
      .update(repositories)
      .set(values)
      .where(eq(repositories.id, existingRow.id))
      .returning({ id: repositories.id });

    return requireReturnedRow(updated, "repository").id;
  }

  const inserted = await database
    .insert(repositories)
    .values(values)
    .onConflictDoUpdate({
      target: [repositories.provider, repositories.owner, repositories.name],
      set: values,
    })
    .returning({ id: repositories.id });

  return requireReturnedRow(inserted, "repository").id;
}

export async function upsertIssues(
  database: Database,
  repositoryId: string,
  values: readonly NormalizedIssue[],
  syncedAt: Date,
): Promise<number> {
  if (values.length === 0) {
    return 0;
  }

  await database
    .insert(issues)
    .values(
      values.map((issue) => ({
        repositoryId,
        providerId: issue.providerId,
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        author: issue.author,
        createdAt: issue.createdAt,
        closedAt: issue.closedAt,
        sourceUpdatedAt: issue.sourceUpdatedAt,
        lastSyncedAt: syncedAt,
        deletedAt: null,
      })),
    )
    .onConflictDoUpdate({
      target: [issues.repositoryId, issues.providerId],
      set: {
        number: sql`excluded.number`,
        title: sql`excluded.title`,
        body: sql`excluded.body`,
        state: sql`excluded.state`,
        author: sql`excluded.author`,
        createdAt: sql`excluded.created_at`,
        closedAt: sql`excluded.closed_at`,
        sourceUpdatedAt: sql`excluded.source_updated_at`,
        lastSyncedAt: syncedAt,
        deletedAt: null,
      },
    });

  return values.length;
}

export interface IssueCommentWriteResult {
  stored: number;
  skippedMissingParent: number;
}

export async function upsertIssueComments(
  database: Database,
  repositoryId: string,
  values: readonly NormalizedIssueComment[],
  syncedAt: Date,
): Promise<IssueCommentWriteResult> {
  const issueNumbers = [
    ...new Set(values.map((comment) => comment.issueNumber)),
  ];
  if (issueNumbers.length === 0) {
    return { stored: 0, skippedMissingParent: 0 };
  }

  const parents = await database
    .select({ id: issues.id, number: issues.number })
    .from(issues)
    .where(
      and(
        eq(issues.repositoryId, repositoryId),
        inArray(issues.number, issueNumbers),
      ),
    );
  const parentIds = new Map(
    parents.flatMap((parent) =>
      parent.number === null ? [] : [[parent.number, parent.id] as const],
    ),
  );
  const writable = values.flatMap((comment) => {
    const issueId = parentIds.get(comment.issueNumber);
    return issueId ? [{ comment, issueId }] : [];
  });

  if (writable.length > 0) {
    await database
      .insert(issueComments)
      .values(
        writable.map(({ comment, issueId }) => ({
          repositoryId,
          issueId,
          providerId: comment.providerId,
          body: comment.body,
          author: comment.author,
          createdAt: comment.createdAt,
          sourceUpdatedAt: comment.sourceUpdatedAt,
          lastSyncedAt: syncedAt,
          deletedAt: null,
        })),
      )
      .onConflictDoUpdate({
        target: [issueComments.repositoryId, issueComments.providerId],
        set: {
          issueId: sql`excluded.issue_id`,
          body: sql`excluded.body`,
          author: sql`excluded.author`,
          createdAt: sql`excluded.created_at`,
          sourceUpdatedAt: sql`excluded.source_updated_at`,
          lastSyncedAt: syncedAt,
          deletedAt: null,
        },
      });
  }

  return {
    stored: writable.length,
    skippedMissingParent: values.length - writable.length,
  };
}

export interface PersistedPullRequest {
  id: string;
  number: number;
}

export async function upsertPullRequests(
  database: Database,
  repositoryId: string,
  values: readonly NormalizedPullRequest[],
  syncedAt: Date,
): Promise<PersistedPullRequest[]> {
  if (values.length === 0) {
    return [];
  }

  return database
    .insert(pullRequests)
    .values(
      values.map((pullRequest) => ({
        repositoryId,
        providerId: pullRequest.providerId,
        number: pullRequest.number,
        title: pullRequest.title,
        body: pullRequest.body,
        state: pullRequest.state,
        author: pullRequest.author,
        baseBranch: pullRequest.baseBranch,
        headBranch: pullRequest.headBranch,
        createdAt: pullRequest.createdAt,
        mergedAt: pullRequest.mergedAt,
        closedAt: pullRequest.closedAt,
        sourceUpdatedAt: pullRequest.sourceUpdatedAt,
        lastSyncedAt: syncedAt,
        deletedAt: null,
      })),
    )
    .onConflictDoUpdate({
      target: [pullRequests.repositoryId, pullRequests.providerId],
      set: {
        number: sql`excluded.number`,
        title: sql`excluded.title`,
        body: sql`excluded.body`,
        state: sql`excluded.state`,
        author: sql`excluded.author`,
        baseBranch: sql`excluded.base_branch`,
        headBranch: sql`excluded.head_branch`,
        createdAt: sql`excluded.created_at`,
        mergedAt: sql`excluded.merged_at`,
        closedAt: sql`excluded.closed_at`,
        sourceUpdatedAt: sql`excluded.source_updated_at`,
        lastSyncedAt: syncedAt,
        deletedAt: null,
      },
    })
    .returning({ id: pullRequests.id, number: pullRequests.number })
    .then((rows) =>
      rows.flatMap((row) =>
        row.number === null ? [] : [{ id: row.id, number: row.number }],
      ),
    );
}

export async function upsertPullRequestFiles(
  database: Database,
  repositoryId: string,
  pullRequestId: string,
  values: readonly NormalizedPullRequestFile[],
  syncedAt: Date,
): Promise<number> {
  if (values.length === 0) {
    return 0;
  }

  await database
    .insert(pullRequestFiles)
    .values(
      values.map((file) => ({
        repositoryId,
        pullRequestId,
        path: file.path,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        lastSyncedAt: syncedAt,
        deletedAt: null,
      })),
    )
    .onConflictDoUpdate({
      target: [
        pullRequestFiles.repositoryId,
        pullRequestFiles.pullRequestId,
        pullRequestFiles.path,
      ],
      set: {
        status: sql`excluded.status`,
        additions: sql`excluded.additions`,
        deletions: sql`excluded.deletions`,
        lastSyncedAt: syncedAt,
        deletedAt: null,
      },
    });

  return values.length;
}

export async function upsertReviews(
  database: Database,
  repositoryId: string,
  pullRequestId: string,
  values: readonly NormalizedReview[],
  syncedAt: Date,
): Promise<number> {
  if (values.length === 0) {
    return 0;
  }

  await database
    .insert(reviews)
    .values(
      values.map((review) => ({
        repositoryId,
        pullRequestId,
        providerId: review.providerId,
        body: review.body,
        author: review.author,
        state: review.state,
        createdAt: review.createdAt,
        sourceUpdatedAt: null,
        lastSyncedAt: syncedAt,
        deletedAt: null,
      })),
    )
    .onConflictDoUpdate({
      target: [reviews.repositoryId, reviews.providerId],
      set: {
        pullRequestId: sql`excluded.pull_request_id`,
        body: sql`excluded.body`,
        author: sql`excluded.author`,
        state: sql`excluded.state`,
        createdAt: sql`excluded.created_at`,
        lastSyncedAt: syncedAt,
        deletedAt: null,
      },
    });

  return values.length;
}

export async function upsertCommits(
  database: Database,
  repositoryId: string,
  values: readonly NormalizedCommit[],
): Promise<number> {
  if (values.length === 0) {
    return 0;
  }

  await database
    .insert(commits)
    .values(
      values.map((commit) => ({
        repositoryId,
        sha: commit.sha,
        message: commit.message,
        author: commit.author,
        authorEmail: commit.authorEmail,
        authoredAt: commit.authoredAt,
        committedAt: commit.committedAt,
      })),
    )
    .onConflictDoUpdate({
      target: [commits.repositoryId, commits.sha],
      set: {
        message: sql`excluded.message`,
        author: sql`excluded.author`,
        authorEmail: sql`excluded.author_email`,
        authoredAt: sql`excluded.authored_at`,
        committedAt: sql`excluded.committed_at`,
      },
    });

  return values.length;
}

export async function upsertGitCommits(
  database: Database,
  repositoryId: string,
  values: readonly GitCommit[],
): Promise<number> {
  if (values.length === 0) {
    return 0;
  }

  await database
    .insert(commits)
    .values(
      values.map((commit) => ({
        repositoryId,
        sha: commit.hash,
        message: commit.body
          ? `${commit.subject}\n\n${commit.body}`
          : commit.subject,
        author: commit.authorName,
        authorEmail: commit.authorEmail || null,
        authoredAt: commit.authoredAt,
        committedAt: commit.committedAt,
      })),
    )
    .onConflictDoUpdate({
      target: [commits.repositoryId, commits.sha],
      set: {
        message: sql`excluded.message`,
        author: sql`excluded.author`,
        authorEmail: sql`excluded.author_email`,
        authoredAt: sql`excluded.authored_at`,
        committedAt: sql`excluded.committed_at`,
      },
    });

  return values.length;
}

export async function synchronizeRepositoryFiles(
  database: Database,
  repositoryId: string,
  values: readonly GitTrackedFile[],
  syncedAt: Date,
): Promise<number> {
  await database.transaction(async (transaction) => {
    for (let offset = 0; offset < values.length; offset += 500) {
      const chunk = values.slice(offset, offset + 500);
      await transaction
        .insert(repositoryFiles)
        .values(
          chunk.map((file) => ({
            repositoryId,
            path: file.path,
            language: file.language,
            extension: file.extension,
            size: file.size,
            lastKnownCommitSha: file.lastKnownCommitSha,
            lastSyncedAt: syncedAt,
          })),
        )
        .onConflictDoUpdate({
          target: [repositoryFiles.repositoryId, repositoryFiles.path],
          set: {
            language: sql`excluded.language`,
            extension: sql`excluded.extension`,
            size: sql`excluded.size`,
            lastKnownCommitSha: sql`excluded.last_known_commit_sha`,
            lastSyncedAt: syncedAt,
          },
        });
    }

    await transaction
      .delete(repositoryFiles)
      .where(
        and(
          eq(repositoryFiles.repositoryId, repositoryId),
          ne(repositoryFiles.lastSyncedAt, syncedAt),
        ),
      );
  });

  return values.length;
}

export async function markRepositoryIndexed(
  database: Database,
  repositoryId: string,
  indexedAt: Date,
): Promise<void> {
  await database
    .update(repositories)
    .set({ indexedAt })
    .where(eq(repositories.id, repositoryId));
}

export async function markRepositoryGitIndexed(
  database: Database,
  repositoryId: string,
  indexedAt: Date,
): Promise<void> {
  await database
    .update(repositories)
    .set({ gitIndexedAt: indexedAt })
    .where(eq(repositories.id, repositoryId));
}
