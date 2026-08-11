import { randomUUID } from "node:crypto";

import { parseGitHubRepositoryUrl } from "@swega/github";
import type { GitHubClient } from "@swega/github";
import type { Database } from "@swega/db";
import { errorFields, type Logger } from "@swega/shared/logging";

import {
  markRepositoryIndexed,
  upsertCommits,
  upsertIssueComments,
  upsertIssues,
  upsertPullRequestFiles,
  upsertPullRequests,
  upsertRepository,
  upsertReviews,
} from "./persistence";

type GitHubIngestionStage =
  | "repository"
  | "issues"
  | "issue_comments"
  | "pull_requests"
  | "pull_request_files"
  | "reviews"
  | "commits"
  | "finalize";

export interface GitHubIngestionCounts {
  repositories: number;
  issues: number;
  issueComments: number;
  skippedIssueComments: number;
  pullRequests: number;
  pullRequestFiles: number;
  reviews: number;
  commits: number;
}

export interface GitHubIngestionOptions {
  database: Database;
  github: GitHubClient;
  logger: Logger;
  repositoryUrl: string;
  limit: number;
  since?: Date;
}

export interface GitHubIngestionResult {
  jobId: string;
  repositoryId: string;
  apiRequests: number;
  counts: GitHubIngestionCounts;
  durationMs: number;
}

export class GitHubIngestionStageError extends Error {
  override readonly name = "GitHubIngestionStageError";
  readonly stage: GitHubIngestionStage;
  readonly repository: string;
  override readonly cause: unknown;

  constructor(stage: GitHubIngestionStage, repository: string, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `GitHub ingestion stage '${stage}' failed for ${repository}: ${causeMessage}`,
    );
    this.stage = stage;
    this.repository = repository;
    this.cause = cause;
  }
}

async function runStage<T>(
  logger: Logger,
  stage: GitHubIngestionStage,
  repository: string,
  operation: () => Promise<T>,
  count: (result: T) => number,
): Promise<T> {
  const startedAt = performance.now();
  logger.info("ingestion.stage.started", { stage });

  try {
    const result = await operation();
    logger.info("ingestion.stage.completed", {
      stage,
      count: count(result),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return result;
  } catch (error) {
    logger.error("ingestion.stage.failed", {
      stage,
      durationMs: Math.round(performance.now() - startedAt),
      ...errorFields(error),
    });
    throw new GitHubIngestionStageError(stage, repository, error);
  }
}

export async function ingestGitHubRepository(
  options: GitHubIngestionOptions,
): Promise<GitHubIngestionResult> {
  const startedAt = performance.now();
  const jobId = randomUUID();
  const repository = parseGitHubRepositoryUrl(options.repositoryUrl);
  const logger = options.logger.child({
    jobId,
    provider: "github",
    repository: `${repository.owner}/${repository.name}`,
  });
  const listOptions = {
    limit: options.limit,
    ...(options.since ? { since: options.since } : {}),
  };

  logger.info("ingestion.started", {
    authenticated: options.github.authenticated,
    limit: options.limit,
    since: options.since?.toISOString() ?? null,
  });

  const syncedAt = new Date();
  const repositoryId = await runStage(
    logger,
    "repository",
    repository.url,
    async () => {
      const metadata = await options.github.getRepository(repository);
      return upsertRepository(options.database, metadata, syncedAt);
    },
    () => 1,
  );
  const repositoryLogger = logger.child({ repositoryId });

  const normalizedIssues = await runStage(
    repositoryLogger,
    "issues",
    repository.url,
    async () => {
      const normalizedIssues = await options.github.listIssues(
        repository,
        listOptions,
      );
      await upsertIssues(
        options.database,
        repositoryId,
        normalizedIssues,
        syncedAt,
      );
      return normalizedIssues;
    },
    (result) => result.length,
  );

  const commentResult = await runStage(
    repositoryLogger,
    "issue_comments",
    repository.url,
    async () => {
      const normalizedComments = await options.github.listIssueComments(
        repository,
        normalizedIssues.map((issue) => issue.number),
        listOptions,
      );
      return upsertIssueComments(
        options.database,
        repositoryId,
        normalizedComments,
        syncedAt,
      );
    },
    (result) => result.stored,
  );
  if (commentResult.skippedMissingParent > 0) {
    repositoryLogger.warn("ingestion.issue_comments.skipped", {
      count: commentResult.skippedMissingParent,
      reason: "parent issue was not present in the bounded dataset",
    });
  }

  const persistedPullRequests = await runStage(
    repositoryLogger,
    "pull_requests",
    repository.url,
    async () => {
      const normalizedPullRequests = await options.github.listPullRequests(
        repository,
        listOptions,
      );
      return upsertPullRequests(
        options.database,
        repositoryId,
        normalizedPullRequests,
        syncedAt,
      );
    },
    (result) => result.length,
  );

  const pullRequestFileCount = await runStage(
    repositoryLogger,
    "pull_request_files",
    repository.url,
    async () => {
      let count = 0;
      for (const pullRequest of persistedPullRequests) {
        try {
          const files = await options.github.listPullRequestFiles(
            repository,
            pullRequest.number,
            listOptions,
          );
          count += await upsertPullRequestFiles(
            options.database,
            repositoryId,
            pullRequest.id,
            files,
            syncedAt,
          );
        } catch (error) {
          throw new Error(
            `pull request #${pullRequest.number}: ${String(error)}`,
            {
              cause: error,
            },
          );
        }
      }
      return count;
    },
    (result) => result,
  );

  const reviewCount = await runStage(
    repositoryLogger,
    "reviews",
    repository.url,
    async () => {
      let count = 0;
      for (const pullRequest of persistedPullRequests) {
        try {
          const normalizedReviews = await options.github.listReviews(
            repository,
            pullRequest.number,
            listOptions,
          );
          count += await upsertReviews(
            options.database,
            repositoryId,
            pullRequest.id,
            normalizedReviews,
            syncedAt,
          );
        } catch (error) {
          throw new Error(
            `pull request #${pullRequest.number}: ${String(error)}`,
            {
              cause: error,
            },
          );
        }
      }
      return count;
    },
    (result) => result,
  );

  const commitCount = await runStage(
    repositoryLogger,
    "commits",
    repository.url,
    async () => {
      const normalizedCommits = await options.github.listCommits(
        repository,
        listOptions,
      );
      return upsertCommits(options.database, repositoryId, normalizedCommits);
    },
    (result) => result,
  );

  await runStage(
    repositoryLogger,
    "finalize",
    repository.url,
    () => markRepositoryIndexed(options.database, repositoryId, new Date()),
    () => 1,
  );

  const result: GitHubIngestionResult = {
    jobId,
    repositoryId,
    apiRequests: options.github.apiRequestCount,
    counts: {
      repositories: 1,
      issues: normalizedIssues.length,
      issueComments: commentResult.stored,
      skippedIssueComments: commentResult.skippedMissingParent,
      pullRequests: persistedPullRequests.length,
      pullRequestFiles: pullRequestFileCount,
      reviews: reviewCount,
      commits: commitCount,
    },
    durationMs: Math.round(performance.now() - startedAt),
  };

  repositoryLogger.info("ingestion.completed", {
    apiRequests: result.apiRequests,
    counts: result.counts,
    durationMs: result.durationMs,
  });

  return result;
}
