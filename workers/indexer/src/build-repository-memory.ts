import { and, eq, isNull } from "drizzle-orm";

import {
  commits,
  issueComments,
  issues,
  pullRequests,
  repositories,
  repositoryFiles,
  reviews,
  type Database,
} from "@swega/db";
import {
  normalizeCommitDocument,
  normalizeIssueCommentDocument,
  normalizeIssueDocument,
  normalizePullRequestDocument,
  normalizeReviewDocument,
  normalizeSourceCodeDocument,
  type GeneratedMemoryDocument,
} from "@swega/documents";
import {
  GitFileTooLargeError,
  type GitRepositoryManager,
  type ManagedGitRepository,
} from "@swega/git";
import { repositoryIdSchema } from "@swega/shared";
import { errorFields, type Logger } from "@swega/shared/logging";

import {
  persistMemoryDocuments,
  type MemoryPersistenceResult,
} from "./repository-memory-persistence";

const DEFAULT_MAX_SOURCE_FILE_BYTES = 512 * 1024;

type RepositoryMemoryStage =
  "load_sources" | "normalize_metadata" | "read_source_code" | "persist";

export interface BuildRepositoryMemoryOptions {
  database: Database;
  git: GitRepositoryManager;
  logger: Logger;
  repositoryId: string;
  maxSourceFileBytes?: number;
}

export interface BuildRepositoryMemoryResult extends MemoryPersistenceResult {
  repositoryId: string;
  skippedSourceFiles: number;
  durationMs: number;
}

export class RepositoryMemoryBuildError extends Error {
  override readonly name = "RepositoryMemoryBuildError";
  readonly stage: RepositoryMemoryStage;
  readonly repositoryId: string;
  override readonly cause: unknown;

  constructor(
    stage: RepositoryMemoryStage,
    repositoryId: string,
    cause: unknown,
  ) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `Repository memory stage '${stage}' failed for ${repositoryId}: ${causeMessage}`,
    );
    this.stage = stage;
    this.repositoryId = repositoryId;
    this.cause = cause;
  }
}

export async function buildRepositoryMemory(
  options: BuildRepositoryMemoryOptions,
): Promise<BuildRepositoryMemoryResult> {
  const startedAt = performance.now();
  const repositoryId = repositoryIdSchema.parse(options.repositoryId);
  const logger = options.logger.child({
    component: "repository_memory",
    repositoryId,
  });
  logger.info("repository_memory.started");

  const sources = await runStage(logger, "load_sources", repositoryId, () =>
    loadSources(options.database, repositoryId),
  );
  const repositoryLogger = logger.child({
    repository: `${sources.repository.owner}/${sources.repository.name}`,
  });
  const metadataDocuments = await runStage(
    repositoryLogger,
    "normalize_metadata",
    repositoryId,
    () => Promise.resolve(normalizeMetadataSources(sources)),
  );
  const sourceCode = await runStage(
    repositoryLogger,
    "read_source_code",
    repositoryId,
    () =>
      normalizeSourceFiles({
        git: options.git,
        logger: repositoryLogger,
        repository: sources.repository,
        files: sources.files,
        maxSourceFileBytes:
          options.maxSourceFileBytes ?? DEFAULT_MAX_SOURCE_FILE_BYTES,
      }),
  );
  const persisted = await runStage(
    repositoryLogger,
    "persist",
    repositoryId,
    () =>
      persistMemoryDocuments(
        options.database,
        [...metadataDocuments, ...sourceCode.documents],
        new Date(),
      ),
  );
  const result: BuildRepositoryMemoryResult = {
    repositoryId,
    ...persisted,
    skippedSourceFiles: sourceCode.skipped,
    durationMs: Math.round(performance.now() - startedAt),
  };
  repositoryLogger.info("repository_memory.completed", {
    documents: result.documents,
    chunks: result.chunks,
    skippedSourceFiles: result.skippedSourceFiles,
    durationMs: result.durationMs,
  });
  return result;
}

async function runStage<T>(
  logger: Logger,
  stage: RepositoryMemoryStage,
  repositoryId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  logger.info("repository_memory.stage.started", { stage });
  try {
    const result = await operation();
    logger.info("repository_memory.stage.completed", {
      stage,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return result;
  } catch (error) {
    logger.error("repository_memory.stage.failed", {
      stage,
      durationMs: Math.round(performance.now() - startedAt),
      ...errorFields(error),
    });
    throw new RepositoryMemoryBuildError(stage, repositoryId, error);
  }
}

async function loadSources(database: Database, repositoryId: string) {
  const repositoryRows = await database
    .select({
      id: repositories.id,
      provider: repositories.provider,
      owner: repositories.owner,
      name: repositories.name,
      url: repositories.url,
    })
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .limit(1);
  const repository = repositoryRows[0];
  if (!repository) {
    throw new Error(`Repository '${repositoryId}' is not registered`);
  }

  const [
    issueRows,
    commentRows,
    pullRequestRows,
    reviewRows,
    commitRows,
    fileRows,
  ] = await Promise.all([
    database
      .select()
      .from(issues)
      .where(
        and(eq(issues.repositoryId, repositoryId), isNull(issues.deletedAt)),
      ),
    database
      .select({
        id: issueComments.id,
        issueId: issueComments.issueId,
        providerId: issueComments.providerId,
        body: issueComments.body,
        author: issueComments.author,
        createdAt: issueComments.createdAt,
        sourceUpdatedAt: issueComments.sourceUpdatedAt,
        issueNumber: issues.number,
      })
      .from(issueComments)
      .innerJoin(
        issues,
        and(
          eq(issueComments.repositoryId, issues.repositoryId),
          eq(issueComments.issueId, issues.id),
        ),
      )
      .where(
        and(
          eq(issueComments.repositoryId, repositoryId),
          isNull(issueComments.deletedAt),
        ),
      ),
    database
      .select()
      .from(pullRequests)
      .where(
        and(
          eq(pullRequests.repositoryId, repositoryId),
          isNull(pullRequests.deletedAt),
        ),
      ),
    database
      .select({
        id: reviews.id,
        pullRequestId: reviews.pullRequestId,
        providerId: reviews.providerId,
        body: reviews.body,
        author: reviews.author,
        state: reviews.state,
        createdAt: reviews.createdAt,
        sourceUpdatedAt: reviews.sourceUpdatedAt,
        pullRequestNumber: pullRequests.number,
      })
      .from(reviews)
      .innerJoin(
        pullRequests,
        and(
          eq(reviews.repositoryId, pullRequests.repositoryId),
          eq(reviews.pullRequestId, pullRequests.id),
        ),
      )
      .where(
        and(eq(reviews.repositoryId, repositoryId), isNull(reviews.deletedAt)),
      ),
    database
      .select()
      .from(commits)
      .where(eq(commits.repositoryId, repositoryId)),
    database
      .select()
      .from(repositoryFiles)
      .where(eq(repositoryFiles.repositoryId, repositoryId)),
  ]);

  return {
    repository,
    issues: issueRows,
    comments: commentRows,
    pullRequests: pullRequestRows,
    reviews: reviewRows,
    commits: commitRows,
    files: fileRows,
  };
}

function normalizeMetadataSources(
  sources: Awaited<ReturnType<typeof loadSources>>,
): GeneratedMemoryDocument[] {
  const { repository } = sources;
  return [
    ...sources.issues.map((issue) =>
      normalizeIssueDocument({
        repositoryId: repository.id,
        sourceEntityId: issue.id,
        sourceVersion: versionAt(issue.sourceUpdatedAt, issue.createdAt),
        sourceReference: providerReference(
          repository.provider,
          "issue",
          issue.providerId,
        ),
        occurredAt: issue.createdAt,
        availableAt: issue.sourceUpdatedAt ?? issue.createdAt,
        number: issue.number,
        title: issue.title,
        body: issue.body,
        author: issue.author,
        state: issue.state,
      }),
    ),
    ...sources.comments.map((comment) =>
      normalizeIssueCommentDocument({
        repositoryId: repository.id,
        sourceEntityId: comment.id,
        sourceVersion: versionAt(comment.sourceUpdatedAt, comment.createdAt),
        sourceReference: providerReference(
          repository.provider,
          "issue_comment",
          comment.providerId,
        ),
        occurredAt: comment.createdAt,
        availableAt: comment.sourceUpdatedAt ?? comment.createdAt,
        issueId: comment.issueId,
        issueNumber: comment.issueNumber,
        body: comment.body,
        author: comment.author,
      }),
    ),
    ...sources.pullRequests.map((pullRequest) =>
      normalizePullRequestDocument({
        repositoryId: repository.id,
        sourceEntityId: pullRequest.id,
        sourceVersion: versionAt(
          pullRequest.sourceUpdatedAt,
          pullRequest.createdAt,
        ),
        sourceReference: providerReference(
          repository.provider,
          "pull_request",
          pullRequest.providerId,
        ),
        occurredAt: pullRequest.createdAt,
        availableAt: pullRequest.sourceUpdatedAt ?? pullRequest.createdAt,
        number: pullRequest.number,
        title: pullRequest.title,
        body: pullRequest.body,
        author: pullRequest.author,
        state: pullRequest.state,
        baseBranch: pullRequest.baseBranch,
        headBranch: pullRequest.headBranch,
      }),
    ),
    ...sources.reviews.map((review) =>
      normalizeReviewDocument({
        repositoryId: repository.id,
        sourceEntityId: review.id,
        sourceVersion: versionAt(review.sourceUpdatedAt, review.createdAt),
        sourceReference: providerReference(
          repository.provider,
          "review",
          review.providerId,
        ),
        occurredAt: review.createdAt,
        availableAt: review.sourceUpdatedAt ?? review.createdAt,
        pullRequestId: review.pullRequestId,
        pullRequestNumber: review.pullRequestNumber,
        state: review.state,
        body: review.body,
        author: review.author,
      }),
    ),
    ...sources.commits.map((commit) =>
      normalizeCommitDocument({
        repositoryId: repository.id,
        sourceEntityId: commit.id,
        sha: commit.sha,
        message: commit.message,
        author: commit.author,
        authoredAt: commit.authoredAt,
        committedAt: commit.committedAt,
        sourceReference: `git:${commit.sha}`,
      }),
    ),
  ];
}

interface NormalizeSourceFilesOptions {
  git: GitRepositoryManager;
  logger: Logger;
  repository: Awaited<ReturnType<typeof loadSources>>["repository"];
  files: Awaited<ReturnType<typeof loadSources>>["files"];
  maxSourceFileBytes: number;
}

async function normalizeSourceFiles(options: NormalizeSourceFilesOptions) {
  const managedRepository = await options.git.cloneRepository({
    repositoryId: options.repository.id,
    remoteUrl: options.repository.url,
  });
  await options.git.updateRepository(managedRepository);
  const commitTimes = new Map<string, Date>();
  const documents: GeneratedMemoryDocument[] = [];
  let skipped = 0;

  for (const file of options.files) {
    const contents = await readTextFile(
      options.git,
      managedRepository,
      file.path,
      file.lastKnownCommitSha,
      options.maxSourceFileBytes,
      options.logger,
    );
    if (contents === null || !contents.trim()) {
      skipped += 1;
      continue;
    }

    let committedAt = commitTimes.get(file.lastKnownCommitSha);
    if (!committedAt) {
      const history = await options.git.getCommitHistory(managedRepository, {
        revision: file.lastKnownCommitSha,
        limit: 1,
      });
      committedAt = history[0]?.committedAt;
      if (!committedAt) {
        throw new Error(
          `Cannot determine commit time for '${file.lastKnownCommitSha}'`,
        );
      }
      commitTimes.set(file.lastKnownCommitSha, committedAt);
    }

    documents.push(
      normalizeSourceCodeDocument({
        repositoryId: options.repository.id,
        sourceEntityId: file.id,
        path: file.path,
        commitSha: file.lastKnownCommitSha,
        committedAt,
        content: contents,
        sourceReference: `git:${file.lastKnownCommitSha}:${file.path}`,
      }),
    );
  }

  return { documents, skipped };
}

async function readTextFile(
  git: GitRepositoryManager,
  repository: ManagedGitRepository,
  path: string,
  revision: string,
  maxBytes: number,
  logger: Logger,
): Promise<string | null> {
  let bytes: Uint8Array;
  try {
    bytes = await git.readFile(repository, path, { revision, maxBytes });
  } catch (error) {
    if (error instanceof GitFileTooLargeError) {
      logger.warn("repository_memory.source_file.skipped", {
        path,
        reason: "too_large",
      });
      return null;
    }
    throw error;
  }

  if (bytes.includes(0)) {
    logger.warn("repository_memory.source_file.skipped", {
      path,
      reason: "binary",
    });
    return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    logger.warn("repository_memory.source_file.skipped", {
      path,
      reason: "non_utf8",
    });
    return null;
  }
}

function versionAt(sourceUpdatedAt: Date | null, createdAt: Date): string {
  return (sourceUpdatedAt ?? createdAt).toISOString();
}

function providerReference(
  provider: string,
  sourceType: string,
  providerId: string,
): string {
  return `provider:${encodeURIComponent(provider)}:${sourceType}:${encodeURIComponent(providerId)}`;
}
