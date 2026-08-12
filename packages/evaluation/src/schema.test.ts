import { describe, expect, test } from "bun:test";

import {
  BenchmarkValidationError,
  DEFAULT_BENCHMARK_CUTOFFS,
  parseRetrievalBenchmark,
} from "./schema";

describe("retrieval benchmark schema", () => {
  test("applies stable defaults and sorts authored cutoffs", () => {
    const benchmark = parseRetrievalBenchmark({
      version: 1,
      name: "fixture",
      cutoffs: [10, 1, 5, 3],
      cases: [validCase()],
    });

    expect(benchmark.cutoffs).toEqual([...DEFAULT_BENCHMARK_CUTOFFS]);
    expect(benchmark.cases[0]?.relevant[0]?.grade).toBe(1);
  });

  test("rejects malformed benchmark definitions", () => {
    expect(() =>
      parseRetrievalBenchmark({
        version: 1,
        name: "malformed",
        cases: [
          {
            ...validCase(),
            repositoryId: "not-a-repository-id",
            relevant: [{ sourceType: "source_code" }],
          },
        ],
      }),
    ).toThrow(BenchmarkValidationError);
  });

  test("rejects duplicate case IDs and relevance selectors", () => {
    expect(() =>
      parseRetrievalBenchmark({
        version: 1,
        name: "duplicates",
        cases: [
          {
            ...validCase(),
            relevant: [
              { path: "src/session.ts" },
              { path: "src/session.ts", grade: 2 },
            ],
          },
          validCase(),
        ],
      }),
    ).toThrow("Duplicate");
  });
});

function validCase() {
  return {
    id: "session-flow",
    query: "where is session handling implemented",
    repositoryId: "123e4567-e89b-42d3-a456-426614174000",
    relevant: [{ path: "src/session.ts", sourceType: "source_code" }],
  };
}
