import { describe, expect, test } from "bun:test";

import {
  ContextBenchmarkValidationError,
  parseContextBenchmark,
} from "./context-schema";

describe("context benchmark schema", () => {
  test("accepts a 20-case development-only evidence corpus", () => {
    const benchmark = parseContextBenchmark(fixture());
    expect(benchmark.cases).toHaveLength(20);
    expect(benchmark.primaryAnchors).toBe(5);
    expect(benchmark.cases[0]?.supporting).toEqual([]);
  });

  test("rejects too-small corpora and duplicate evidence selectors", () => {
    const tooSmall = fixture();
    tooSmall.cases = tooSmall.cases.slice(0, 19);
    expect(() => parseContextBenchmark(tooSmall)).toThrow(
      ContextBenchmarkValidationError,
    );

    const duplicate = fixture();
    duplicate.cases[0] = {
      ...duplicate.cases[0],
      supporting: [{ path: "src/required.ts" }],
    };
    expect(() => parseContextBenchmark(duplicate)).toThrow(
      "Duplicate context evidence target selector",
    );
  });

  test("accepts a sealed 10-case held-out corpus with review provenance", () => {
    const heldOut = {
      ...fixture(),
      split: "held_out" as const,
      corpusAuthor: "Independent source reviewer",
      reviewCount: 1,
      sealedAt: "2025-03-14T00:00:00.000Z",
      cases: fixture().cases.slice(0, 10),
    };
    expect(parseContextBenchmark(heldOut)).toMatchObject({
      split: "held_out",
      corpusAuthor: "Independent source reviewer",
      reviewCount: 1,
    });
  });

  test("rejects unsealed or oversized held-out corpora", () => {
    const unsealed = {
      ...fixture(),
      split: "held_out",
      cases: fixture().cases.slice(0, 10),
    };
    expect(() => parseContextBenchmark(unsealed)).toThrow(
      ContextBenchmarkValidationError,
    );

    const oversized = {
      ...unsealed,
      corpusAuthor: "Reviewer",
      reviewCount: 1,
      sealedAt: "2025-03-14T00:00:00.000Z",
      cases: fixture().cases.slice(0, 16),
    };
    expect(() => parseContextBenchmark(oversized)).toThrow(
      ContextBenchmarkValidationError,
    );
  });
});

function fixture() {
  const cases: Record<string, unknown>[] = Array.from(
    { length: 20 },
    (_, index) => ({
      id: `case-${index}`,
      query: `query ${index}`,
      repositoryId: "123e4567-e89b-42d3-a456-426614174000",
      before: "2025-03-15T00:00:00.000Z",
      category: "cross_file",
      difficulty: "medium",
      notes: "Required evidence was inspected directly.",
      required: [{ path: "src/required.ts" }],
    }),
  );
  return {
    version: 1 as const,
    name: "Context fixture",
    description: "A manually reviewable fixture.",
    split: "development" as const,
    repositoryRevision: "abc123",
    groundTruthMethod: "Inspected source directly.",
    contextBudget: 1_000,
    cases,
  };
}
