import { eq } from "drizzle-orm";

import { repositories, type Database } from "@swega/db";
import type { GitRepositoryManager } from "@swega/git";
import { repositoryIdSchema } from "@swega/shared";
import { errorFields, type Logger } from "@swega/shared/logging";

import {
  markRepositoryGitIndexed,
  synchronizeRepositoryFiles,
  upsertGitCommits,
} from "./persistence";

type GitSynchronizationStage =
  "repository_lookup" | "clone" | "update" | "commits" | "files" | "finalize";

export interface GitSynchronizationCounts {
  commits: number;
  files: number;
}

export interface GitSynchronizationOptions {
  database: Database;
  git: GitRepositoryManager;
  logger: Logger;
  repositoryId: string;
  commitLimit: number;
  since?: Date;
}

export interface GitSynchronizationResult {
  repositoryId: string;
  localDirectory: string;
  revisionSha: string;
  counts: GitSynchronizationCounts;
  durationMs: number;
}

export class GitSynchronizationStageError extends Error {
  override readonly name = "GitSynchronizationStageError";
  readonly stage: GitSynchronizationStage;
  readonly repositoryId: string;
  override readonly cause: unknown;

  constructor(
    stage: GitSynchronizationStage,
    repositoryId: string,
    cause: unknown,
  ) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `Git synchronization stage '${stage}' failed for ${repositoryId}: ${causeMessage}`,
    );
    this.stage = stage;
    this.repositoryId = repositoryId;
    this.cause = cause;
  }
}

async function runStage<T>(
  logger: Logger,
  stage: GitSynchronizationStage,
  repositoryId: string,
  operation: () => Promise<T>,
  count: (result: T) => number,
): Promise<T> {
  const startedAt = performance.now();
  logger.info("git_sync.stage.started", { stage });

  try {
    const result = await operation();
    logger.info("git_sync.stage.completed", {
      stage,
      count: count(result),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return result;
  } catch (error) {
    logger.error("git_sync.stage.failed", {
      stage,
      durationMs: Math.round(performance.now() - startedAt),
      ...errorFields(error),
    });
    throw new GitSynchronizationStageError(stage, repositoryId, error);
  }
}

export async function synchronizeGitRepository(
  options: GitSynchronizationOptions,
): Promise<GitSynchronizationResult> {
  const startedAt = performance.now();
  const repositoryId = repositoryIdSchema.parse(options.repositoryId);
  const logger = options.logger.child({
    component: "git_sync",
    repositoryId,
  });

  logger.info("git_sync.started", {
    commitLimit: options.commitLimit,
    since: options.since?.toISOString() ?? null,
  });

  const repository = await runStage(
    logger,
    "repository_lookup",
    repositoryId,
    async () => {
      const rows = await options.database
        .select({
          id: repositories.id,
          owner: repositories.owner,
          name: repositories.name,
          url: repositories.url,
          defaultBranch: repositories.defaultBranch,
        })
        .from(repositories)
        .where(eq(repositories.id, repositoryId))
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw new Error(`Repository '${repositoryId}' is not registered`);
      }
      return row;
    },
    () => 1,
  );
  const repositoryLogger = logger.child({
    repository: `${repository.owner}/${repository.name}`,
  });

  const localRepository = await runStage(
    repositoryLogger,
    "clone",
    repositoryId,
    () =>
      options.git.cloneRepository({
        repositoryId,
        remoteUrl: repository.url,
      }),
    () => 1,
  );

  await runStage(
    repositoryLogger,
    "update",
    repositoryId,
    () => options.git.updateRepository(localRepository),
    () => 1,
  );

  const revision = repository.defaultBranch
    ? `refs/remotes/origin/${repository.defaultBranch}`
    : "refs/remotes/origin/HEAD";
  const historyOptions = {
    revision,
    limit: options.commitLimit,
    ...(options.since ? { since: options.since } : {}),
  };

  const commitCount = await runStage(
    repositoryLogger,
    "commits",
    repositoryId,
    async () => {
      const history = await options.git.getCommitHistory(
        localRepository,
        historyOptions,
      );
      return upsertGitCommits(options.database, repositoryId, history);
    },
    (result) => result,
  );

  const revisionSha = await options.git.resolveRevision(
    localRepository,
    revision,
  );
  const syncedAt = new Date();
  const fileCount = await runStage(
    repositoryLogger,
    "files",
    repositoryId,
    async () => {
      const files = await options.git.listFiles(localRepository, revisionSha);
      return synchronizeRepositoryFiles(
        options.database,
        repositoryId,
        files,
        syncedAt,
      );
    },
    (result) => result,
  );

  await runStage(
    repositoryLogger,
    "finalize",
    repositoryId,
    () => markRepositoryGitIndexed(options.database, repositoryId, new Date()),
    () => 1,
  );

  const result: GitSynchronizationResult = {
    repositoryId,
    localDirectory: localRepository.directory,
    revisionSha,
    counts: { commits: commitCount, files: fileCount },
    durationMs: Math.round(performance.now() - startedAt),
  };

  repositoryLogger.info("git_sync.completed", {
    revisionSha,
    counts: result.counts,
    durationMs: result.durationMs,
  });

  return result;
}
