import { describe, expect, test } from "bun:test";

import type { MemorySearchResult } from "./types";
import { diversifyCandidatesByPath } from "./diversify";

describe("candidate path diversification", () => {
  test("keeps multiple chunks per path up to the configured bound", () => {
    const diversified = diversifyCandidatesByPath(
      [
        result("a-1", "src/a.ts"),
        result("a-2", "src/a.ts"),
        result("a-3", "src/a.ts"),
        result("b-1", "src/b.ts"),
      ],
      { limit: 3, maxCandidatesPerPath: 2 },
    );

    expect(diversified.map(id)).toEqual(["a-1", "a-2", "b-1"]);
  });

  test("reserves space for a later exact-symbol match", () => {
    const diversified = diversifyCandidatesByPath(
      [
        result("a-1", "src/a.ts"),
        result("b-1", "src/b.ts"),
        result("c-1", "src/c.ts"),
        result("a-exact", "src/a.ts", { structuredExactMatch: true }),
      ],
      { limit: 3, maxCandidatesPerPath: 1 },
    );

    expect(diversified.map(id)).toEqual(["b-1", "c-1", "a-exact"]);
    expect(
      diversified.filter((candidate) => candidate.path === "src/a.ts"),
    ).toHaveLength(1);
  });

  test("allows a second legitimate symbol after an exact match", () => {
    const diversified = diversifyCandidatesByPath(
      [
        result("a-exact", "src/a.ts", { structuredExactMatch: true }),
        result("a-implementation", "src/a.ts"),
        result("a-metadata", "src/a.ts"),
      ],
      { limit: 2, maxCandidatesPerPath: 2 },
    );

    expect(diversified.map(id)).toEqual(["a-exact", "a-implementation"]);
  });

  test("is deterministic for tied input and does not cap pathless sources", () => {
    const input = [
      result("pathless-a", null),
      result("pathless-b", null),
      result("path-a", "src/a.ts"),
    ];
    expect(diversifyCandidatesByPath(input, options())).toEqual(
      diversifyCandidatesByPath(input, options()),
    );
    expect(diversifyCandidatesByPath(input, options()).map(id)).toEqual([
      "pathless-a",
      "pathless-b",
      "path-a",
    ]);
  });
});

function options() {
  return { limit: 3, maxCandidatesPerPath: 1 };
}

function id(result: MemorySearchResult): string {
  return result.sourceMetadata.chunkId;
}

function result(
  chunkId: string,
  path: string | null,
  overrides: Partial<MemorySearchResult> = {},
): MemorySearchResult {
  const timestamp = new Date("2025-03-01T00:00:00.000Z");
  return {
    repositoryId: "123e4567-e89b-42d3-a456-426614174000",
    content: chunkId,
    similarity: 0,
    sourceType: path ? "source_code" : "issue",
    sourceId: "123e4567-e89b-42d3-a456-426614174001",
    timestamp,
    path,
    sourceMetadata: {
      documentId: `document-${chunkId}`,
      chunkId,
      sourceReference: `fixture:${chunkId}`,
      parentSourceType: null,
      parentSourceEntityId: null,
      occurredAt: timestamp,
      availableAt: timestamp,
      path,
      commitSha: path ? "fixture" : null,
      startLine: path ? 1 : null,
      endLine: path ? 10 : null,
      language: path ? "TypeScript" : null,
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
