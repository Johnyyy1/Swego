#!/usr/bin/env bun

import { createDatabase } from "@swega/db";
import { GitHubClient } from "@swega/github";
import {
  GitHubIngestionStageError,
  ingestGitHubRepository,
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
  const github = new GitHubClient({
    logger,
    ...(environment.GITHUB_TOKEN ? { token: environment.GITHUB_TOKEN } : {}),
  });

  try {
    await ingestGitHubRepository({
      database: database.db,
      github,
      logger,
      repositoryUrl: arguments_.repositoryUrl,
      limit: arguments_.limit,
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
    ...(error instanceof GitHubIngestionStageError
      ? { stage: error.stage }
      : {}),
    ...errorFields(error),
  });
  process.exitCode = 1;
}
