import { describe, expect, test } from "bun:test";

import type { MemorySearchResult } from "./types";
import { reciprocalRankFusion } from "./rrf";

describe("reciprocalRankFusion", () => {
  test("accumulates 1-based dense and lexical ranks without mixing raw scores", () => {
    const denseOnly = result("dense-only", {
      similarity: 0.91,
      denseSimilarity: 0.91,
    });
    const sharedDense = result("shared", {
      similarity: 0.4,
      denseSimilarity: 0.4,
    });
    const sharedLexical = result("shared", {
      lexicalScore: 8.5,
    });
    const lexicalOnly = result("lexical-only", {
      lexicalScore: 100,
    });

    const fused = reciprocalRankFusion(
      [denseOnly, sharedDense],
      [sharedLexical, lexicalOnly],
      { limit: 10, k: 60 },
    );

    expect(fused.map((candidate) => candidate.sourceMetadata.chunkId)).toEqual([
      "shared",
      "dense-only",
      "lexical-only",
    ]);
    expect(fused[0]).toMatchObject({
      denseRank: 2,
      lexicalRank: 1,
      denseSimilarity: 0.4,
      lexicalScore: 8.5,
      similarity: 0.4,
    });
    expect(fused[0]?.rrfScore).toBeCloseTo(1 / 62 + 1 / 61, 12);
    expect(fused[1]).toMatchObject({
      denseRank: 1,
      denseSimilarity: 0.91,
    });
    expect(fused[1]?.lexicalRank).toBeUndefined();
    expect(fused[1]?.rrfScore).toBeCloseTo(1 / 61, 12);
    expect(fused[2]).toMatchObject({
      lexicalRank: 2,
      lexicalScore: 100,
      similarity: 0,
    });
    expect(fused[2]?.denseRank).toBeUndefined();
    expect(fused[2]?.rrfScore).toBeCloseTo(1 / 62, 12);
  });

  test("deduplicates each candidate list and breaks equal-rank ties by chunk ID", () => {
    const candidateB = result("chunk-b");
    const candidateA = result("chunk-a", { lexicalScore: 1 });

    const fused = reciprocalRankFusion(
      [candidateB, candidateB],
      [candidateA, candidateA],
      { limit: 10 },
    );

    expect(fused.map((candidate) => candidate.sourceMetadata.chunkId)).toEqual([
      "chunk-a",
      "chunk-b",
    ]);
    expect(fused[0]?.rrfScore).toBeCloseTo(1 / 61, 12);
    expect(fused[1]?.rrfScore).toBeCloseTo(1 / 61, 12);
  });

  test("returns an empty result when both candidate sets are empty", () => {
    expect(reciprocalRankFusion([], [], { limit: 10 })).toEqual([]);
  });
});

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
