import { describe, expect, test } from "bun:test";

import type {
  MemorySearchResult,
  RepositoryMemory,
  SearchMemoryInput,
} from "./types";
import { HybridRepositoryMemory } from "./hybrid";

describe("HybridRepositoryMemory", () => {
  test("uses independent candidate pools, one cutoff, and RRF ordering", async () => {
    const denseInputs: SearchMemoryInput[] = [];
    const lexicalInputs: SearchMemoryInput[] = [];
    const dense = memoryStub(
      [result("dense-only", { similarity: 0.9 }), result("shared")],
      denseInputs,
    );
    const lexical = memoryStub(
      [
        result("shared", { lexicalScore: 2 }),
        result("lexical-only", { lexicalScore: 1 }),
      ],
      lexicalInputs,
    );
    const hybrid = new HybridRepositoryMemory(dense, lexical);

    const results = await hybrid.searchMemory({
      repositoryId: "123e4567-e89b-42d3-a456-426614174000",
      query: "  authentication session  ",
      limit: 3,
    });

    expect(denseInputs).toHaveLength(1);
    expect(lexicalInputs).toHaveLength(1);
    expect(denseInputs[0]).toMatchObject({
      query: "authentication session",
      limit: 30,
    });
    expect(lexicalInputs[0]).toMatchObject({
      query: "authentication session",
      limit: 30,
    });
    expect(denseInputs[0]?.before).toBe(lexicalInputs[0]?.before);
    expect(
      results.map((candidate) => candidate.sourceMetadata.chunkId),
    ).toEqual(["shared", "dense-only", "lexical-only"]);
  });

  test("preserves dense projection compatibility failures", async () => {
    const projectionError = new Error("missing embeddings");
    const dense: RepositoryMemory = {
      searchMemory: async () => {
        throw projectionError;
      },
    };
    const hybrid = new HybridRepositoryMemory(dense, memoryStub([]));

    await expect(
      hybrid.searchMemory({
        repositoryId: "123e4567-e89b-42d3-a456-426614174000",
        query: "authentication",
      }),
    ).rejects.toBe(projectionError);
  });
});

function memoryStub(
  results: readonly MemorySearchResult[],
  inputs: SearchMemoryInput[] = [],
): RepositoryMemory {
  return {
    searchMemory: async (input) => {
      inputs.push(input);
      return results;
    },
  };
}

function result(
  chunkId: string,
  overrides: Partial<MemorySearchResult> = {},
): MemorySearchResult {
  const timestamp = new Date("2025-03-01T00:00:00.000Z");
  return {
    repositoryId: "123e4567-e89b-42d3-a456-426614174000",
    content: chunkId,
    similarity: 0,
    sourceType: "issue",
    sourceId: "123e4567-e89b-42d3-a456-426614174001",
    timestamp,
    path: null,
    sourceMetadata: {
      documentId: `document-${chunkId}`,
      chunkId,
      sourceReference: `provider:test:issue:${chunkId}`,
      parentSourceType: null,
      parentSourceEntityId: null,
      occurredAt: timestamp,
      availableAt: timestamp,
      path: null,
      commitSha: null,
      startLine: null,
      endLine: null,
      language: null,
      symbolId: null,
      symbolName: null,
      symbolKind: null,
      parentSymbol: null,
      symbolPart: null,
      symbolPartCount: null,
    },
    ...overrides,
  };
}
