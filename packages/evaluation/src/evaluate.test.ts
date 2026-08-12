import { describe, expect, test } from "bun:test";

import {
  RerankedRepositoryMemory,
  type DiagnosticRepositoryMemory,
  type MemorySearchResult,
  type RepositoryMemory,
} from "@swega/retrieval";

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

  test("compares hybrid and hybrid plus reranking through the same harness", async () => {
    const benchmark = parseRetrievalBenchmark({
      version: 1,
      name: "reranking comparison",
      cutoffs: [1, 3],
      cases: [
        {
          id: "session-flow",
          query: "session implementation",
          repositoryId,
          relevant: [{ path: "src/session.ts", grade: 3 }],
        },
      ],
    });
    const hybrid = strategy("hybrid", [
      result("src/documentation.ts"),
      result("src/session.ts"),
    ]);
    const hybridReranked = new RerankedRepositoryMemory(hybrid.memory, {
      provider: "fixture",
      model: "fixture",
      rerank: async ({ candidates }) =>
        candidates.map((candidate) => ({
          candidateId: candidate.id,
          score: candidate.id.includes("session") ? 1 : 0,
        })),
    });

    const report = await evaluateRetrievalBenchmark(benchmark, [
      hybrid,
      { name: "hybrid+rerank", memory: hybridReranked },
    ]);

    expect(report.strategies.map((item) => item.strategy)).toEqual([
      "hybrid",
      "hybrid+rerank",
    ]);
    expect(report.strategies[0]?.aggregate.mrr).toBe(0.5);
    expect(report.strategies[1]?.aggregate.mrr).toBe(1);
  });

  test("distinguishes absent candidates from targets reranked below K", async () => {
    const benchmark = parseRetrievalBenchmark({
      version: 1,
      name: "candidate diagnostics",
      cutoffs: [1],
      cases: [
        {
          id: "session-flow",
          query: "session implementation",
          repositoryId,
          relevant: [
            { path: "src/session.ts", grade: 3 },
            { path: "src/proxy-session.ts", grade: 2 },
          ],
        },
      ],
    });
    const finalResults = [result("src/unrelated.ts")];
    const candidates = [result("src/unrelated.ts"), result("src/session.ts")];
    const memory: DiagnosticRepositoryMemory = {
      searchMemory: async () => finalResults,
      searchMemoryWithDiagnostics: async () => ({
        results: finalResults,
        candidates,
        diagnostics: {
          candidateGenerationDurationMs: 4,
          rerankingDurationMs: 12,
          candidateCount: 2,
          candidateBytes: 1024,
        },
      }),
    };

    const report = await evaluateRetrievalBenchmark(benchmark, [
      { name: "hybrid+rerank", memory },
    ]);
    const diagnostics = report.strategies[0]?.cases[0]?.candidateDiagnostics;

    expect(diagnostics).toMatchObject({
      candidateRecall: 0.5,
      candidateCount: 2,
      missingRelevant: [
        {
          target: { path: "src/session.ts" },
          reason: "reranked_below_cutoff",
          candidateRank: 2,
        },
        {
          target: { path: "src/proxy-session.ts" },
          reason: "absent_from_candidate_pool",
          candidateRank: null,
        },
      ],
    });
    expect(report.strategies[0]?.aggregate.candidateDiagnostics).toMatchObject({
      candidateRecall: 0.5,
      meanCandidateBytes: 1024,
      meanRerankingDurationMs: 12,
      targetOutcomeCounts: {
        absent_from_candidate_pool: 1,
        wrong_chunk_from_target_file: 0,
        reranked_below_cutoff: 1,
        successfully_returned: 0,
      },
    });
    expect(formatBenchmarkReport(report)).toContain(
      "absent_from_candidate_pool",
    );
    expect(formatBenchmarkReport(report)).toContain("reranked_below_cutoff");
  });

  test("classifies a wrong candidate chunk from a relevant file", async () => {
    const benchmark = parseRetrievalBenchmark({
      version: 1,
      name: "chunk diagnostics",
      cutoffs: [1],
      cases: [
        {
          id: "session-flow",
          query: "session implementation",
          repositoryId,
          category: "implementation",
          relevant: [
            {
              path: "src/session.ts",
              symbolName: "getSession",
              grade: 3,
            },
          ],
        },
      ],
    });
    const wrongChunk = result("src/session.ts", repositoryId, "helper");
    const memory: DiagnosticRepositoryMemory = {
      searchMemory: async () => [wrongChunk],
      searchMemoryWithDiagnostics: async () => ({
        results: [wrongChunk],
        candidates: [wrongChunk],
        diagnostics: {
          candidateGenerationDurationMs: 1,
          rerankingDurationMs: 1,
          candidateCount: 1,
          candidateBytes: 1,
        },
      }),
    };

    const report = await evaluateRetrievalBenchmark(benchmark, [
      { name: "hybrid+rerank", memory },
    ]);

    expect(
      report.strategies[0]?.cases[0]?.candidateDiagnostics?.targetOutcomes,
    ).toEqual([
      {
        target: expect.objectContaining({ symbolName: "getSession" }),
        outcome: "wrong_chunk_from_target_file",
        candidateRank: null,
        finalRank: null,
      },
    ]);
    expect(report.strategies[0]?.categories[0]).toMatchObject({
      category: "implementation",
      cases: 1,
    });
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
  symbolName: string | null = null,
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
      language: "TypeScript",
      symbolId: null,
      symbolName,
      symbolKind: null,
      parentSymbol: null,
      symbolPart: null,
      symbolPartCount: null,
    },
  };
}
