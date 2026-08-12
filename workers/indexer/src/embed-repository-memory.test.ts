import { describe, expect, test } from "bun:test";

import { documentChunks, repositories, type Database } from "@swega/db";
import type { EmbeddingProvider } from "@swega/embeddings";
import { EMBEDDING_DIMENSIONS } from "@swega/shared";
import type { Logger, LogFields } from "@swega/shared/logging";

import { embedRepositoryMemory } from "./embed-repository-memory";

describe("embedRepositoryMemory", () => {
  test("embeds stale chunks through the injected provider and reports skipped chunks", async () => {
    const repositoryId = "123e4567-e89b-42d3-a456-426614174000";
    const embeddedInputs: string[][] = [];
    const insertedValues: unknown[] = [];
    const logEntries: Array<{ event: string; fields: LogFields }> = [];
    const provider: EmbeddingProvider = {
      provider: "test-provider",
      model: "test-model",
      dimensions: EMBEDDING_DIMENSIONS,
      embed: async (inputs) => {
        embeddedInputs.push([...inputs]);
        return inputs.map(() => unitVector());
      },
    };
    const rows = [
      {
        chunkId: "stale-long",
        content: "embed this substantially longer chunk",
        contentHash: "hash-stale-long",
        path: "src/stale-long.ts",
        sourceType: "source_code",
        sourceReference: "git:test:src/stale-long.ts",
        chunkIndex: 0,
        startLine: 1,
        endLine: 10,
        embeddedProvider: null,
        embeddedModel: null,
        embeddedDimensions: null,
        embeddedContentHash: null,
      },
      {
        chunkId: "stale",
        content: "embed this chunk",
        contentHash: "hash-stale",
        path: "src/stale.ts",
        sourceType: "source_code",
        sourceReference: "git:test:src/stale.ts",
        chunkIndex: 0,
        startLine: 1,
        endLine: 10,
        embeddedProvider: null,
        embeddedModel: null,
        embeddedDimensions: null,
        embeddedContentHash: null,
      },
      {
        chunkId: "current",
        content: "skip this chunk",
        contentHash: "hash-current",
        path: "src/current.ts",
        sourceType: "source_code",
        sourceReference: "git:test:src/current.ts",
        chunkIndex: 0,
        startLine: 1,
        endLine: 10,
        embeddedProvider: provider.provider,
        embeddedModel: provider.model,
        embeddedDimensions: provider.dimensions,
        embeddedContentHash: "hash-current",
      },
    ];
    const database = {
      select: () => ({
        from: (table: unknown) => {
          if (table === repositories) {
            return {
              where: () => ({ limit: async () => [{ id: repositoryId }] }),
            };
          }
          if (table === documentChunks) {
            return {
              leftJoin: () => ({ where: async () => rows }),
            };
          }
          throw new Error("Unexpected table in test database");
        },
      }),
      insert: () => ({
        values: (values: unknown) => {
          insertedValues.push(values);
          return { onConflictDoUpdate: async () => undefined };
        },
      }),
    } as unknown as Database;

    const result = await embedRepositoryMemory({
      database,
      embeddings: provider,
      logger: recordingLogger(logEntries),
      repositoryId,
      batchSize: 1,
    });

    expect(embeddedInputs).toEqual([
      ["embed this chunk"],
      ["embed this substantially longer chunk"],
    ]);
    expect(insertedValues).toHaveLength(2);
    expect(result).toMatchObject({
      chunks: 3,
      embedded: 2,
      skipped: 1,
      unchanged: 1,
    });
    expect(logEntries.at(-1)).toMatchObject({
      event: "memory_embeddings.completed",
      fields: {
        embeddingProvider: "test-provider",
        embeddingModel: "test-model",
        chunks: 3,
        embedded: 2,
        skipped: 1,
      },
    });
    expect(
      logEntries.find(
        (entry) => entry.event === "memory_embeddings.batch.started",
      ),
    ).toMatchObject({
      fields: {
        batchSize: 1,
        minInputCharacters: 16,
        maxInputCharacters: 16,
        totalInputCharacters: 16,
        requestedDimensions: EMBEDDING_DIMENSIONS,
        model: "test-model",
      },
    });
    expect(JSON.stringify(logEntries)).not.toContain("embed this chunk");
  });
});

function unitVector(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) =>
    index === 0 ? 1 : 0,
  );
}

function recordingLogger(
  entries: Array<{ event: string; fields: LogFields }>,
  baseFields: LogFields = {},
): Logger {
  const record = (event: string, fields: LogFields = {}) => {
    entries.push({ event, fields: { ...baseFields, ...fields } });
  };
  return {
    debug: record,
    info: record,
    warn: record,
    error: record,
    child: (fields) => recordingLogger(entries, { ...baseFields, ...fields }),
  };
}
