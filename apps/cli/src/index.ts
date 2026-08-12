#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabase } from "@swega/db";
import {
  evaluateRetrievalBenchmark,
  formatBenchmarkReport,
  parseRetrievalBenchmark,
} from "@swega/evaluation";
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
import type { MemorySearchResult } from "@swega/retrieval";
import {
  loadRootEnvironment,
  parseServerEnvironment,
} from "@swega/shared/environment";
import { createJsonLogger, errorFields } from "@swega/shared/logging";

import { helpText, parseCliArguments } from "./arguments";
import { formatDoctorReport, isDoctorReady, runDoctor } from "./doctor";
import { resolveConfiguredEmbeddingProvider } from "./embedding-provider";
import {
  createConfiguredRetrievalStrategies,
  requireRerankedStrategy,
} from "./retrieval-strategies";
import {
  requireConfiguredReranker,
  resolveConfiguredReranker,
} from "./reranker-provider";

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
    if (arguments_.command === "doctor") {
      const report = await runDoctor(
        database,
        resolveConfiguredEmbeddingProvider(environment),
        resolveConfiguredReranker(environment),
      );
      console.log(formatDoctorReport(report));
      if (!isDoctorReady(report)) {
        process.exitCode = 1;
      }
      return;
    }

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
      arguments_.command === "search" ||
      arguments_.command === "benchmark"
    ) {
      const embeddings = resolveConfiguredEmbeddingProvider(environment);

      if (arguments_.command === "embed-memory") {
        await embedRepositoryMemory({
          database: database.db,
          embeddings,
          logger,
          repositoryId: arguments_.repositoryId,
        });
        return;
      }

      const reranker = arguments_.rerank
        ? requireConfiguredReranker(environment)
        : undefined;
      const strategies = createConfiguredRetrievalStrategies(
        database.db,
        embeddings,
        reranker,
        {
          ...(arguments_.candidateLimit === undefined
            ? {}
            : { candidateLimit: arguments_.candidateLimit }),
          ...(arguments_.pathLimit === undefined
            ? {}
            : { maxCandidatesPerPath: arguments_.pathLimit }),
          ...(arguments_.fileEvidence === undefined
            ? {}
            : { fileEvidenceStrategy: arguments_.fileEvidence }),
          ...(arguments_.relationshipExpansion === undefined
            ? {}
            : {
                relationshipExpansionStrategy: arguments_.relationshipExpansion,
              }),
        },
      );
      if (arguments_.command === "benchmark") {
        const benchmark = await loadBenchmark(arguments_.benchmarkFile);
        const benchmarkStrategies = [
          { name: "dense", memory: strategies.dense },
          { name: "lexical", memory: strategies.lexical },
          { name: "structured", memory: strategies.structured },
          { name: "hybrid", memory: strategies.hybrid },
          ...(arguments_.rerank
            ? [
                {
                  name: "hybrid+rerank",
                  memory: requireRerankedStrategy(strategies),
                },
              ]
            : []),
        ];
        const report = await evaluateRetrievalBenchmark(
          benchmark,
          benchmarkStrategies,
        );
        console.log(
          arguments_.json
            ? JSON.stringify(report, null, 2)
            : formatBenchmarkReport(report),
        );
        return;
      }

      const memory = arguments_.rerank
        ? requireRerankedStrategy(strategies)
        : strategies.hybrid;
      const results = await memory.searchMemory({
        repositoryId: arguments_.repositoryId,
        query: arguments_.query,
        limit: arguments_.limit,
        ...(arguments_.before ? { before: arguments_.before } : {}),
      });
      console.log(
        JSON.stringify(
          arguments_.debug
            ? results.map((result, index) => ({
                rank: index + 1,
                ...result,
              }))
            : results.map(toLegacySearchResult),
          null,
          2,
        ),
      );
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

async function loadBenchmark(path: string) {
  const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const candidates = isAbsolute(path)
    ? [path]
    : [...new Set([resolve(path), resolve(projectRoot, path)])];
  let source: string | undefined;
  let benchmarkPath = candidates[0] ?? path;
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      source = await readFile(candidate, "utf8");
      benchmarkPath = candidate;
      break;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(`${candidate}: ${detail}`);
    }
  }
  if (source === undefined) {
    throw new Error(
      `Unable to read benchmark '${path}': ${failures.join("; ")}`,
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Benchmark '${benchmarkPath}' is not valid JSON: ${detail}`,
      { cause: error },
    );
  }
  return parseRetrievalBenchmark(input);
}

function toLegacySearchResult(result: MemorySearchResult) {
  return {
    repositoryId: result.repositoryId,
    content: result.content,
    similarity: result.similarity,
    sourceType: result.sourceType,
    sourceId: result.sourceId,
    timestamp: result.timestamp,
    path: result.path,
    sourceMetadata: result.sourceMetadata,
  };
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
