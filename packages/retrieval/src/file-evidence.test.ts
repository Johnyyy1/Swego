import { describe, expect, test } from "bun:test";

import { buildFileEvidenceRepresentatives } from "./file-evidence";
import type { MemorySearchResult } from "./types";

describe("buildFileEvidenceRepresentatives", () => {
  test("aggregates independent branches and selects exact plus implementation chunks", () => {
    const lexical = result("lexical", "src/auth.ts", {
      symbolKind: "module",
    });
    const exact = result("exact", "src/auth.ts", {
      symbolName: "authenticateRequest",
      symbolKind: "function",
      structuredExactMatch: true,
    });
    const implementation = result("implementation", "src/auth.ts", {
      symbolName: "handleUnauthorized",
      symbolKind: "function",
    });

    const representatives = buildFileEvidenceRepresentatives(
      [implementation],
      [lexical],
      [exact, implementation],
      {
        strategy: "multi-branch",
        query: "authenticateRequest unauthorized handling",
      },
    );

    expect(representatives.map(chunkId)).toEqual(["exact", "implementation"]);
    expect(representatives[0]).toMatchObject({
      fileEvidenceRank: 1,
      fileEvidenceSources: ["dense", "lexical", "structured"],
      representativeChunkReason: "exact-symbol",
      propagatedFromFileEvidence: true,
    });
    expect(representatives[1]).toMatchObject({
      representativeChunkReason: "query-symbol-overlap",
      denseRank: 1,
      structuredRank: 2,
    });
  });

  test("prefers an implementation symbol over a metadata-only multi-branch chunk", () => {
    const metadata = result("metadata", "src/service.ts", {
      symbolName: "ServiceOptions",
      symbolKind: "interface",
    });
    const implementation = result("implementation", "src/service.ts", {
      symbolName: "executeService",
      symbolKind: "function",
    });

    const representatives = buildFileEvidenceRepresentatives(
      [metadata],
      [metadata, implementation],
      [],
      {
        strategy: "multi-branch",
        query: "how does the service execute",
        representativeChunksPerFile: 1,
      },
    );

    expect(representatives.map(chunkId)).toEqual(["implementation"]);
    expect(representatives[0]?.representativeChunkReason).toBe(
      "query-symbol-overlap",
    );
  });

  test("does not let a large file win max evidence merely by chunk count", () => {
    const large = Array.from({ length: 20 }, (_, index) =>
      result(`large-${index}`, "src/large.ts"),
    );
    const strongest = result("strongest", "src/focused.ts");

    const representatives = buildFileEvidenceRepresentatives(
      [strongest, ...large],
      [],
      [],
      { strategy: "max", query: "focused" },
    );

    expect(representatives[0]).toMatchObject({
      path: "src/focused.ts",
      fileEvidenceRank: 1,
    });
    expect(
      representatives.filter((candidate) => candidate.path === "src/large.ts"),
    ).toHaveLength(2);
  });

  test("bounds top-N aggregation and handles one chunk without structural metadata", () => {
    const single = result("single", "src/single.txt");
    const many = Array.from({ length: 10 }, (_, index) =>
      result(`many-${index}`, "src/many.txt"),
    );
    const first = buildFileEvidenceRepresentatives([single, ...many], [], [], {
      strategy: "bounded-top-n",
      query: "plain text",
      boundedChunkCount: 2,
    });
    const second = buildFileEvidenceRepresentatives([single, ...many], [], [], {
      strategy: "bounded-top-n",
      query: "plain text",
      boundedChunkCount: 2,
    });

    expect(first.map(chunkId)).toEqual(second.map(chunkId));
    expect(
      first.find((candidate) => chunkId(candidate) === "single"),
    ).toMatchObject({
      representativeChunkReason: "best-direct-rank",
      fileEvidenceSources: ["dense"],
    });
  });

  test("keeps repository evidence isolated even for identical paths", () => {
    const otherRepository = "223e4567-e89b-42d3-a456-426614174000";
    const representatives = buildFileEvidenceRepresentatives(
      [
        result("one", "src/shared.ts"),
        result("two", "src/shared.ts", { repositoryId: otherRepository }),
      ],
      [],
      [],
      { strategy: "multi-branch", query: "shared" },
    );

    expect(representatives).toHaveLength(2);
    expect(new Set(representatives.map((item) => item.repositoryId))).toEqual(
      new Set(["123e4567-e89b-42d3-a456-426614174000", otherRepository]),
    );
  });

  test("breaks equal file and chunk evidence ties deterministically", () => {
    const representatives = buildFileEvidenceRepresentatives(
      [result("z", "src/b.ts")],
      [result("a", "src/a.ts")],
      [],
      { strategy: "max", query: "unmatched" },
    );

    expect(representatives.map((item) => item.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
    expect(representatives.map(chunkId)).toEqual(["a", "z"]);
  });
});

function chunkId(result: MemorySearchResult): string {
  return result.sourceMetadata.chunkId;
}

function result(
  chunk: string,
  path: string,
  overrides: Partial<MemorySearchResult> & {
    symbolName?: string;
    symbolKind?: MemorySearchResult["sourceMetadata"]["symbolKind"];
  } = {},
): MemorySearchResult {
  const timestamp = new Date("2025-03-01T00:00:00.000Z");
  const {
    symbolName = null,
    symbolKind = null,
    ...resultOverrides
  } = overrides;
  return {
    repositoryId: "123e4567-e89b-42d3-a456-426614174000",
    content: chunk,
    similarity: 0,
    sourceType: "source_code",
    sourceId: "123e4567-e89b-42d3-a456-426614174001",
    timestamp,
    path,
    sourceMetadata: {
      documentId: `document-${chunk}`,
      chunkId: chunk,
      sourceReference: `git:test:${path}`,
      parentSourceType: null,
      parentSourceEntityId: null,
      occurredAt: timestamp,
      availableAt: timestamp,
      path,
      commitSha: "abc123",
      startLine: 1,
      endLine: 10,
      language: "typescript",
      symbolId: symbolName ? `symbol-${chunk}` : null,
      symbolName,
      symbolKind,
      parentSymbol: null,
      symbolPart: symbolName ? 1 : null,
      symbolPartCount: symbolName ? 1 : null,
    },
    ...resultOverrides,
  };
}
