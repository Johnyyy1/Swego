import { describe, expect, test } from "bun:test";

import type { MemorySearchResult } from "@swega/retrieval";

import { evaluateRanking, matchesRelevanceTarget } from "./metrics";
import { parseRetrievalBenchmark } from "./schema";

describe("retrieval metrics", () => {
  test("returns zero metrics when no relevant result is retrieved", () => {
    const evaluation = evaluateRanking(
      [result("src/unrelated.ts")],
      [target("src/relevant.ts")],
      [1, 3],
    );

    expect(evaluation).toMatchObject({
      reciprocalRank: 0,
      firstRelevantRank: null,
      at: {
        "1": { precision: 0, recall: 0, hitRate: 0, ndcg: 0 },
        "3": { precision: 0, recall: 0, hitRate: 0, ndcg: 0 },
      },
    });
  });

  test("scores a relevant result at rank one", () => {
    const evaluation = evaluateRanking(
      [result("src/relevant.ts")],
      [target("src/relevant.ts")],
      [1, 3],
    );

    expect(evaluation.reciprocalRank).toBe(1);
    expect(evaluation.firstRelevantRank).toBe(1);
    expect(evaluation.at["1"]).toEqual({
      precision: 1,
      recall: 1,
      hitRate: 1,
      ndcg: 1,
    });
    expect(evaluation.at["3"]).toEqual({
      precision: 1 / 3,
      recall: 1,
      hitRate: 1,
      ndcg: 1,
    });
  });

  test("scores a relevant result at a later rank", () => {
    const evaluation = evaluateRanking(
      [
        result("src/first.ts"),
        result("src/second.ts"),
        result("src/relevant.ts"),
      ],
      [target("src/relevant.ts")],
      [1, 3],
    );

    expect(evaluation.reciprocalRank).toBeCloseTo(1 / 3, 12);
    expect(evaluation.at["1"]).toEqual({
      precision: 0,
      recall: 0,
      hitRate: 0,
      ndcg: 0,
    });
    expect(evaluation.at["3"]?.precision).toBeCloseTo(1 / 3, 12);
    expect(evaluation.at["3"]?.recall).toBe(1);
    expect(evaluation.at["3"]?.hitRate).toBe(1);
    expect(evaluation.at["3"]?.ndcg).toBeCloseTo(0.5, 12);
  });

  test("scores multiple graded relevant targets once each", () => {
    const evaluation = evaluateRanking(
      [
        result("src/primary.ts"),
        result("src/unrelated.ts"),
        result("src/secondary.ts"),
        result("src/primary.ts"),
      ],
      [target("src/primary.ts", 3), target("src/secondary.ts", 1)],
      [1, 3, 5],
    );

    expect(evaluation.targetRanks).toEqual([1, 3]);
    expect(evaluation.at["1"]).toMatchObject({
      precision: 1,
      recall: 0.5,
      hitRate: 1,
      ndcg: 1,
    });
    expect(evaluation.at["3"]?.precision).toBeCloseTo(2 / 3, 12);
    expect(evaluation.at["3"]?.recall).toBe(1);
    expect(evaluation.at["3"]?.ndcg).toBeCloseTo(
      (7 + 1 / 2) / (7 + 1 / Math.log2(3)),
      12,
    );
    expect(evaluation.at["5"]?.precision).toBeCloseTo(2 / 5, 12);
  });

  test("matches stable source references without database row IDs", () => {
    const searchResult = result("src/session.ts");
    expect(
      matchesRelevanceTarget(searchResult, {
        sourceReference: "git:fixture:src/session.ts",
        sourceType: "source_code",
        grade: 1,
      }),
    ).toBe(true);
    expect(
      matchesRelevanceTarget(searchResult, {
        sourceReference: "git:fixture:src/other.ts",
        grade: 1,
      }),
    ).toBe(false);
  });
});

function target(path: string, grade = 1) {
  const benchmark = parseRetrievalBenchmark({
    version: 1,
    name: "target fixture",
    cases: [
      {
        id: "target",
        query: "query",
        repositoryId: "123e4567-e89b-42d3-a456-426614174000",
        relevant: [{ path, sourceType: "source_code", grade }],
      },
    ],
  });
  const relevanceTarget = benchmark.cases[0]?.relevant[0];
  if (!relevanceTarget) {
    throw new Error("Expected relevance target fixture");
  }
  return relevanceTarget;
}

function result(
  path: string,
  repositoryId = "123e4567-e89b-42d3-a456-426614174000",
): MemorySearchResult {
  const timestamp = new Date("2025-03-01T00:00:00.000Z");
  return {
    repositoryId,
    content: path,
    similarity: 0,
    sourceType: "source_code",
    sourceId: "123e4567-e89b-42d3-a456-426614174001",
    timestamp,
    path,
    sourceMetadata: {
      documentId: `document:${path}`,
      chunkId: `chunk:${path}`,
      sourceReference: `git:fixture:${path}`,
      parentSourceType: null,
      parentSourceEntityId: null,
      occurredAt: timestamp,
      availableAt: timestamp,
      path,
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
  };
}
