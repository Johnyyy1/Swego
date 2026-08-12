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
    const structuredInputs: SearchMemoryInput[] = [];
    const hybrid = new HybridRepositoryMemory(
      dense,
      lexical,
      memoryStub([], structuredInputs),
    );

    const results = await hybrid.searchMemory({
      repositoryId: "123e4567-e89b-42d3-a456-426614174000",
      query: "  authentication session  ",
      limit: 3,
    });

    expect(denseInputs).toHaveLength(1);
    expect(lexicalInputs).toHaveLength(1);
    expect(structuredInputs).toHaveLength(1);
    expect(denseInputs[0]).toMatchObject({
      query: "authentication session",
      limit: 300,
    });
    expect(lexicalInputs[0]).toMatchObject({
      query: "authentication session",
      limit: 300,
    });
    expect(structuredInputs[0]).toMatchObject({
      query: "authentication session",
      limit: 300,
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
    const hybrid = new HybridRepositoryMemory(
      dense,
      memoryStub([]),
      memoryStub([]),
    );

    await expect(
      hybrid.searchMemory({
        repositoryId: "123e4567-e89b-42d3-a456-426614174000",
        query: "authentication",
      }),
    ).rejects.toBe(projectionError);
  });

  test("uses configurable branch and per-path candidate limits", async () => {
    const denseInputs: SearchMemoryInput[] = [];
    const hybrid = new HybridRepositoryMemory(
      memoryStub(
        [
          result("a-1", { path: "src/a.ts" }),
          result("a-2", { path: "src/a.ts" }),
          result("b-1", { path: "src/b.ts" }),
        ],
        denseInputs,
      ),
      memoryStub([]),
      memoryStub([]),
      {
        denseCandidateLimit: 75,
        lexicalCandidateLimit: 50,
        structuredCandidateLimit: 30,
        maxCandidatesPerPath: 1,
      },
    );

    const results = await hybrid.searchMemory({
      repositoryId: "123e4567-e89b-42d3-a456-426614174000",
      query: "session",
      limit: 2,
    });

    expect(denseInputs[0]?.limit).toBe(75);
    expect(results.map((candidate) => candidate.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
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
