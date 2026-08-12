import { describe, expect, test } from "bun:test";

import type { MemorySearchResult, RepositoryMemory } from "@swega/retrieval";

import {
  EvaluationRepositoryMismatchError,
  evaluateRetrievalBenchmark,
} from "./evaluate";
import { formatBenchmarkReport } from "./format";
import { parseRetrievalBenchmark } from "./schema";

const repositoryId = "123e4567-e89b-42d3-a456-426614174000";

describe("retrieval benchmark evaluation", () => {
  test("compares retrieval strategies and produces deterministic reports", async () => {
    const benchmark = parseRetrievalBenchmark({
      version: 1,
      name: "strategy comparison",
      cutoffs: [1, 3],
      cases: [
        {
          id: "session-flow",
          query: "session handling implementation",
          repositoryId,
          before: "2025-03-15T00:00:00.000Z",
          relevant: [{ path: "src/session.ts", grade: 2 }],
        },
      ],
    });
    const strategies = [
      strategy("dense", [result("src/unrelated.ts"), result("src/session.ts")]),
      strategy("lexical", [result("src/unrelated.ts")]),
      strategy("hybrid", [result("src/session.ts")]),
    ];

    const first = await evaluateRetrievalBenchmark(benchmark, strategies);
    const second = await evaluateRetrievalBenchmark(benchmark, strategies);

    expect(first.strategies.map((report) => report.strategy)).toEqual([
      "dense",
      "lexical",
      "hybrid",
    ]);
    expect(first.strategies[0]?.aggregate.mrr).toBe(0.5);
    expect(first.strategies[1]?.aggregate.mrr).toBe(0);
    expect(first.strategies[2]?.aggregate.mrr).toBe(1);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(formatBenchmarkReport(first)).toBe(formatBenchmarkReport(second));
    expect(formatBenchmarkReport(first)).toContain("Per-query failures @3");
    expect(formatBenchmarkReport(first)).toContain("[lexical] session-flow");
  });

  test("rejects a result from a different repository", async () => {
    const benchmark = parseRetrievalBenchmark({
      version: 1,
      name: "repository isolation",
      cases: [
        {
          id: "session-flow",
          query: "session handling implementation",
          repositoryId,
          relevant: [{ path: "src/session.ts" }],
        },
      ],
    });
    const mismatchedRepositoryId = "123e4567-e89b-42d3-a456-426614174099";

    await expect(
      evaluateRetrievalBenchmark(benchmark, [
        strategy("broken", [result("src/session.ts", mismatchedRepositoryId)]),
      ]),
    ).rejects.toBeInstanceOf(EvaluationRepositoryMismatchError);
  });
});

function strategy(name: string, results: readonly MemorySearchResult[]) {
  const memory: RepositoryMemory = {
    searchMemory: async () => results,
  };
  return { name, memory };
}

function result(
  path: string,
  resultRepositoryId = repositoryId,
): MemorySearchResult {
  const timestamp = new Date("2025-03-01T00:00:00.000Z");
  return {
    repositoryId: resultRepositoryId,
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
    },
  };
}
