#!/usr/bin/env bun

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabase } from "@swega/db";
import { OpenAIEmbeddingProvider } from "@swega/embeddings";
import { GitCliRepositoryManager } from "@swega/git";
import { GitHubClient } from "@swega/github";
import {
  GitHubIngestionStageError,
  GitSynchronizationStageError,
  RepositoryMemoryBuildError,
  buildRepositoryMemory,
  embedRepositoryMemory,
  ingestGitHubRepository,
  synchronizeGitRepository,
} from "@swega/indexer";
import { PgVectorRepositoryMemory } from "@swega/retrieval";
import {
  loadRootEnvironment,
  parseServerEnvironment,
} from "@swega/shared/environment";
import { createJsonLogger, errorFields } from "@swega/shared/logging";

import { helpText, parseCliArguments } from "./arguments";

async function main(): Promise<void> {
  const arguments_ = parseCliArguments(Bun.argv.slice(2));
  if (arguments_.command === "help") {
    console.log(helpText());
    return;
  }

  loadRootEnvironment();
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

    if (
      arguments_.command === "embed-memory" ||
      arguments_.command === "search"
    ) {
      if (!environment.OPENAI_API_KEY) {
        throw new Error(
          "OPENAI_API_KEY is required for memory embedding and search",
        );
      }
      const embeddings = new OpenAIEmbeddingProvider({
        apiKey: environment.OPENAI_API_KEY,
        ...(environment.SWEGA_EMBEDDING_MODEL
          ? { model: environment.SWEGA_EMBEDDING_MODEL }
          : {}),
      });

      if (arguments_.command === "embed-memory") {
        await embedRepositoryMemory({
          database: database.db,
          embeddings,
          logger,
          repositoryId: arguments_.repositoryId,
        });
        return;
      }

      const memory = new PgVectorRepositoryMemory(database.db, embeddings);
      const results = await memory.searchMemory({
        repositoryId: arguments_.repositoryId,
        query: arguments_.query,
        limit: arguments_.limit,
        ...(arguments_.before ? { before: arguments_.before } : {}),
      });
      console.log(JSON.stringify(results, null, 2));
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
    if (arguments_.command === "ingest-git") {
      await synchronizeGitRepository({
        database: database.db,
        git,
        logger,
        repositoryId: arguments_.repositoryId,
        commitLimit: arguments_.limit,
        ...(arguments_.since ? { since: arguments_.since } : {}),
      });
      return;
    }

    await buildRepositoryMemory({
      database: database.db,
      git,
      logger,
      repositoryId: arguments_.repositoryId,
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
    error instanceof GitSynchronizationStageError ||
    error instanceof RepositoryMemoryBuildError
      ? { stage: error.stage }
      : {}),
    ...errorFields(error),
  });
  process.exitCode = 1;
}
