#!/usr/bin/env bun

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabase } from "@swega/db";
import { GitCliRepositoryManager } from "@swega/git";
import { GitHubClient } from "@swega/github";
import {
  GitHubIngestionStageError,
  GitSynchronizationStageError,
  ingestGitHubRepository,
  synchronizeGitRepository,
} from "@swega/indexer";
import { parseServerEnvironment } from "@swega/shared/environment";
import { createJsonLogger, errorFields } from "@swega/shared/logging";

import { helpText, parseCliArguments } from "./arguments";

async function main(): Promise<void> {
  const arguments_ = parseCliArguments(Bun.argv.slice(2));
  if (arguments_.command === "help") {
    console.log(helpText());
    return;
  }

  const environment = parseServerEnvironment(process.env);
  const logger = createJsonLogger({ application: "swega-cli" });
  const database = createDatabase({ url: environment.DATABASE_URL });

  try {
    if (arguments_.command === "ingest") {
      const github = new GitHubClient({
        logger,
        ...(environment.GITHUB_TOKEN
          ? { token: environment.GITHUB_TOKEN }
          : {}),
      });
      await ingestGitHubRepository({
        database: database.db,
        github,
        logger,
        repositoryUrl: arguments_.repositoryUrl,
        limit: arguments_.limit,
        ...(arguments_.since ? { since: arguments_.since } : {}),
      });
      return;
    }

    const defaultRepositoryDirectory = fileURLToPath(
      new URL("../../../.swega/repositories", import.meta.url),
    );
    const git = new GitCliRepositoryManager({
      rootDirectory: environment.SWEGA_REPOSITORY_DIR
        ? resolve(environment.SWEGA_REPOSITORY_DIR)
        : defaultRepositoryDirectory,
    });
    await synchronizeGitRepository({
      database: database.db,
      git,
      logger,
      repositoryId: arguments_.repositoryId,
      commitLimit: arguments_.limit,
      ...(arguments_.since ? { since: arguments_.since } : {}),
    });
  } finally {
    await database.close();
  }
}

try {
  await main();
} catch (error) {
  const logger = createJsonLogger({ application: "swega-cli" });
  logger.error("cli.failed", {
    ...(error instanceof GitHubIngestionStageError ||
    error instanceof GitSynchronizationStageError
      ? { stage: error.stage }
      : {}),
    ...errorFields(error),
  });
  process.exitCode = 1;
}
