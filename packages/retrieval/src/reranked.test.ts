import { describe, expect, test } from "bun:test";

import type { Reranker, RerankInput } from "@swega/reranking";

import { HybridRepositoryMemory } from "./hybrid";
import {
  DEFAULT_RERANK_CANDIDATE_LIMIT,
  RerankedRepositoryMemory,
} from "./reranked";
import type {
  MemorySearchResult,
  RepositoryMemory,
  SearchMemoryInput,
} from "./types";

const repositoryId = "123e4567-e89b-42d3-a456-426614174000";

describe("RerankedRepositoryMemory", () => {
  test("reranks a bounded unique hybrid candidate set and preserves scores", async () => {
    const hybridInputs: SearchMemoryInput[] = [];
    const rerankInputs: RerankInput[] = [];
    const hybrid = memoryStub(
      [
        result("documentation", { rrfScore: 0.03 }),
        result("implementation", { rrfScore: 0.02 }),
        result("implementation", { rrfScore: 0.02 }),
      ],
      hybridInputs,
    );
    const reranked = new RerankedRepositoryMemory(
      hybrid,
      rerankerStub(
        [
          { candidateId: "implementation", score: 0.9 },
          { candidateId: "documentation", score: 0.2 },
        ],
        rerankInputs,
      ),
    );

    const results = await reranked.searchMemory({
      repositoryId,
      query: "session implementation",
      limit: 2,
    });

    expect(hybridInputs[0]?.limit).toBe(DEFAULT_RERANK_CANDIDATE_LIMIT);
    expect(rerankInputs[0]?.candidates).toHaveLength(2);
    expect(results.map((item) => item.sourceMetadata.chunkId)).toEqual([
      "implementation",
      "documentation",
    ]);
    expect(results[0]).toMatchObject({
      rrfScore: 0.02,
      rrfRank: 2,
      rerankerScore: 0.9,
      rerankerRank: 1,
      finalRank: 1,
    });
    expect(results[1]).toMatchObject({
      rrfScore: 0.03,
      rrfRank: 1,
      rerankerScore: 0.2,
      rerankerRank: 2,
      finalRank: 2,
    });
    expect(rerankInputs[0]?.candidates[1]?.text).toContain(
      "Path: src/implementation.ts",
    );
    expect(rerankInputs[0]?.candidates[1]?.text).toContain(
      "Content:\nimplementation",
    );
  });

  test("rejects final limits larger than the bounded candidate pool", async () => {
    const reranked = new RerankedRepositoryMemory(
      memoryStub([]),
      rerankerStub([]),
      { candidateLimit: 20 },
    );

    await expect(
      reranked.searchMemory({
        repositoryId,
        query: "session",
        limit: 21,
      }),
    ).rejects.toThrow("exceeds the configured candidate limit 20");
  });

  test("never sends more than the configured candidate limit", async () => {
    const rerankInputs: RerankInput[] = [];
    const candidates = Array.from({ length: 25 }, (_, index) =>
      result(`candidate-${index}`),
    );
    const reranked = new RerankedRepositoryMemory(
      memoryStub(candidates),
      {
        provider: "fixture",
        model: "fixture",
        rerank: async (input) => {
          rerankInputs.push(input);
          return input.candidates.map((candidate, index) => ({
            candidateId: candidate.id,
            score: -index,
          }));
        },
      },
      { candidateLimit: 20 },
    );

    await reranked.searchMemory({
      repositoryId,
      query: "session",
      limit: 10,
    });

    expect(rerankInputs[0]?.candidates).toHaveLength(20);
  });

  test("rejects missing, unknown, duplicate, and non-finite scores", async () => {
    const malformedScores = [
      [{ candidateId: "one", score: 0.2 }],
      [
        { candidateId: "one", score: 0.2 },
        { candidateId: "unknown", score: 0.1 },
      ],
      [
        { candidateId: "one", score: 0.2 },
        { candidateId: "one", score: 0.1 },
      ],
      [
        { candidateId: "one", score: 0.2 },
        { candidateId: "two", score: Number.NaN },
      ],
    ];

    for (const scores of malformedScores) {
      const reranked = new RerankedRepositoryMemory(
        memoryStub([result("one"), result("two")]),
        rerankerStub(scores),
      );
      await expect(
        reranked.searchMemory({ repositoryId, query: "session" }),
      ).rejects.toThrow();
    }
  });

  test("breaks reranker ties by original RRF rank", async () => {
    const reranked = new RerankedRepositoryMemory(
      memoryStub([result("chunk-b"), result("chunk-a")]),
      rerankerStub([
        { candidateId: "chunk-a", score: 0.5 },
        { candidateId: "chunk-b", score: 0.5 },
      ]),
    );

    const results = await reranked.searchMemory({
      repositoryId,
      query: "session",
      limit: 2,
    });

    expect(results.map((item) => item.sourceMetadata.chunkId)).toEqual([
      "chunk-b",
      "chunk-a",
    ]);
  });

  test("composes after dense, lexical, and RRF retrieval", async () => {
    const hybrid = new HybridRepositoryMemory(
      memoryStub([result("dense-only"), result("shared")]),
      memoryStub([result("shared"), result("lexical-only")]),
    );
    const reranked = new RerankedRepositoryMemory(
      hybrid,
      rerankerStub([
        { candidateId: "shared", score: 0.3 },
        { candidateId: "dense-only", score: 0.8 },
        { candidateId: "lexical-only", score: 0.5 },
      ]),
    );

    const results = await reranked.searchMemory({
      repositoryId,
      query: "implementation",
      limit: 3,
    });

    expect(results.map((item) => item.sourceMetadata.chunkId)).toEqual([
      "dense-only",
      "lexical-only",
      "shared",
    ]);
    expect(
      results.find((item) => item.sourceMetadata.chunkId === "shared"),
    ).toMatchObject({ denseRank: 2, lexicalRank: 1, rrfRank: 1 });
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

function rerankerStub(
  scores: Awaited<ReturnType<Reranker["rerank"]>>,
  inputs: RerankInput[] = [],
): Reranker {
  return {
    provider: "fixture",
    model: "fixture",
    rerank: async (input) => {
      inputs.push(input);
      return scores;
    },
  };
}

function result(
  chunkId: string,
  overrides: Partial<MemorySearchResult> = {},
): MemorySearchResult {
  const timestamp = new Date("2025-03-01T00:00:00.000Z");
  return {
    repositoryId,
    content: chunkId,
    similarity: 0,
    sourceType: "source_code",
    sourceId: "123e4567-e89b-42d3-a456-426614174001",
    timestamp,
    path: `src/${chunkId}.ts`,
    sourceMetadata: {
      documentId: `document-${chunkId}`,
      chunkId,
      sourceReference: `git:fixture:${chunkId}`,
      parentSourceType: null,
      parentSourceEntityId: null,
      occurredAt: timestamp,
      availableAt: timestamp,
      path: `src/${chunkId}.ts`,
      commitSha: "fixture",
      startLine: 1,
      endLine: 10,
      language: "TypeScript",
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
