import { describe, expect, test } from "bun:test";

import type { Database } from "@swega/db";
import type { EmbeddingProvider } from "@swega/embeddings";
import { EMBEDDING_DIMENSIONS } from "@swega/shared";

import {
  EmbeddingCompatibilityError,
  PgVectorRepositoryMemory,
} from "./postgres";

describe("PgVectorRepositoryMemory", () => {
  test("embeds the query through the injected compatible provider", async () => {
    const repositoryId = "123e4567-e89b-42d3-a456-426614174000";
    const queryInputs: string[][] = [];
    const provider: EmbeddingProvider = {
      provider: "test-provider",
      model: "test-model",
      dimensions: EMBEDDING_DIMENSIONS,
      embed: async (inputs) => {
        queryInputs.push([...inputs]);
        return inputs.map(() => unitVector());
      },
    };
    const availableAt = new Date("2025-03-01T00:00:00.000Z");
    const database = {
      select: () => ({
        from: () => ({
          where: () => ({
            groupBy: async () => [
              {
                provider: provider.provider,
                model: provider.model,
                dimensions: provider.dimensions,
              },
            ],
          }),
          innerJoin: () => ({
            where: () => ({
              orderBy: () => ({
                limit: async () => [
                  {
                    repositoryId,
                    documentId: "document-1",
                    chunkId: "chunk-1",
                    content: "semantic result",
                    similarity: 0.9,
                    sourceType: "issue",
                    sourceId: "123e4567-e89b-42d3-a456-426614174001",
                    sourceReference: "provider:test:issue:1",
                    parentSourceType: null,
                    parentSourceEntityId: null,
                    occurredAt: availableAt,
                    availableAt,
                    path: null,
                    commitSha: null,
                    startLine: null,
                    endLine: null,
                  },
                ],
              }),
            }),
          }),
        }),
      }),
    } as unknown as Database;
    const memory = new PgVectorRepositoryMemory(database, provider);

    const results = await memory.searchMemory({
      repositoryId,
      query: "semantic query",
    });

    expect(queryInputs).toEqual([["semantic query"]]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      repositoryId,
      content: "semantic result",
      sourceType: "issue",
    });
  });

  test("rejects incompatible stored embeddings before embedding the query", async () => {
    const repositoryId = "123e4567-e89b-42d3-a456-426614174000";
    let queryEmbedded = false;
    const provider: EmbeddingProvider = {
      provider: "configured-provider",
      model: "configured-model",
      dimensions: EMBEDDING_DIMENSIONS,
      embed: async () => {
        queryEmbedded = true;
        return [unitVector()];
      },
    };
    const database = {
      select: () => ({
        from: () => ({
          where: () => ({
            groupBy: async () => [
              {
                provider: "stored-provider",
                model: "stored-model",
                dimensions: EMBEDDING_DIMENSIONS,
              },
            ],
          }),
        }),
      }),
    } as unknown as Database;
    const memory = new PgVectorRepositoryMemory(database, provider);

    await expect(
      memory.searchMemory({ repositoryId, query: "semantic query" }),
    ).rejects.toBeInstanceOf(EmbeddingCompatibilityError);
    expect(queryEmbedded).toBe(false);
  });

  test("rejects a repository without stored embeddings", async () => {
    const repositoryId = "123e4567-e89b-42d3-a456-426614174000";
    const provider: EmbeddingProvider = {
      provider: "configured-provider",
      model: "configured-model",
      dimensions: EMBEDDING_DIMENSIONS,
      embed: async () => [unitVector()],
    };
    const database = {
      select: () => ({
        from: () => ({
          where: () => ({ groupBy: async () => [] }),
        }),
      }),
    } as unknown as Database;
    const memory = new PgVectorRepositoryMemory(database, provider);

    await expect(
      memory.searchMemory({ repositoryId, query: "semantic query" }),
    ).rejects.toThrow("has no stored embeddings");
  });
});

function unitVector(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) =>
    index === 0 ? 1 : 0,
  );
}
