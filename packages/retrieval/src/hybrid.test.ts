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
      { fileEvidenceStrategy: "none" },
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
      { fileEvidenceStrategy: "none" },
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
        fileEvidenceStrategy: "none",
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

  test("uses multi-branch file evidence and preserves two legitimate symbols", async () => {
    const exact = result("exact", {
      path: "src/auth.ts",
      sourceMetadata: metadata("exact", "src/auth.ts", {
        symbolName: "authenticateRequest",
        symbolKind: "function",
      }),
      structuredExactMatch: true,
    });
    const implementation = result("implementation", {
      path: "src/auth.ts",
      sourceMetadata: metadata("implementation", "src/auth.ts", {
        symbolName: "handleUnauthorized",
        symbolKind: "function",
      }),
    });
    const metadataChunk = result("metadata", {
      path: "src/auth.ts",
      sourceMetadata: metadata("metadata", "src/auth.ts", {
        symbolName: "AuthOptions",
        symbolKind: "interface",
      }),
    });
    const hybrid = new HybridRepositoryMemory(
      memoryStub([implementation, metadataChunk]),
      memoryStub([metadataChunk, exact]),
      memoryStub([exact, implementation]),
      {
        fileEvidenceStrategy: "multi-branch",
        maxCandidatesPerPath: 2,
      },
    );

    const results = await hybrid.searchMemory({
      repositoryId: "123e4567-e89b-42d3-a456-426614174000",
      query: "authenticateRequest unauthorized implementation",
      limit: 2,
      before: new Date("2025-03-02T00:00:00.000Z"),
    });

    expect(
      results.map((candidate) => candidate.sourceMetadata.chunkId),
    ).toEqual(["exact", "implementation"]);
    expect(
      results.every((candidate) => candidate.propagatedFromFileEvidence),
    ).toBe(true);
    expect(results[0]?.representativeChunkReason).toBe("exact-symbol");
  });

  test("uses the resolved temporal cutoff before file aggregation", async () => {
    const observedCutoffs: Date[] = [];
    const cutoffMemory: RepositoryMemory = {
      searchMemory: async (input) => {
        observedCutoffs.push(input.before ?? new Date(0));
        return input.before &&
          input.before <= new Date("2025-03-02T00:00:00.000Z")
          ? [result("available", { path: "src/available.ts" })]
          : [result("future", { path: "src/future.ts" })];
      },
    };
    const hybrid = new HybridRepositoryMemory(
      cutoffMemory,
      cutoffMemory,
      cutoffMemory,
      { fileEvidenceStrategy: "multi-branch" },
    );
    const before = new Date("2025-03-02T00:00:00.000Z");

    const results = await hybrid.searchMemory({
      repositoryId: "123e4567-e89b-42d3-a456-426614174000",
      query: "available behavior",
      limit: 10,
      before,
    });

    expect(observedCutoffs).toEqual([before, before, before]);
    expect(results.map((candidate) => candidate.path)).toEqual([
      "src/available.ts",
    ]);
  });

  test("expands one hop from strong file evidence and preserves direct provenance", async () => {
    const anchor = result("wrapper", {
      path: "src/api-wrapper.ts",
      sourceMetadata: metadata("wrapper", "src/api-wrapper.ts", {
        symbolName: "apiWrapper",
        symbolKind: "function",
      }),
    });
    const related = result("authenticate", {
      path: "src/authenticate-request.ts",
      sourceMetadata: metadata("authenticate", "src/authenticate-request.ts", {
        symbolName: "authenticateRequest",
        symbolKind: "function",
      }),
      relationshipType: "imports",
      relationshipSourcePath: "src/api-wrapper.ts",
      relationshipTargetPath: "src/authenticate-request.ts",
      relationshipTargetSymbol: "authenticateRequest",
      relationshipDepth: 1,
      relationshipReason: "imports ./authenticate-request",
      relationshipRank: 1,
      retrievedDirectly: false,
    });
    const observedAnchors: (readonly MemorySearchResult[])[] = [];
    const hybrid = new HybridRepositoryMemory(
      memoryStub([anchor]),
      memoryStub([anchor]),
      memoryStub([]),
      {
        fileEvidenceStrategy: "multi-branch",
        relationshipExpansion: {
          expand: async (input) => {
            observedAnchors.push(input.anchors);
            return [related];
          },
        },
      },
    );

    const results = await hybrid.searchMemory({
      repositoryId: "123e4567-e89b-42d3-a456-426614174000",
      query: "unauthorized request handling",
      limit: 2,
    });

    expect(observedAnchors).toHaveLength(1);
    expect(observedAnchors[0]?.map((candidate) => candidate.path)).toEqual([
      "src/api-wrapper.ts",
    ]);
    expect(results.map((candidate) => candidate.path)).toEqual([
      "src/api-wrapper.ts",
      "src/authenticate-request.ts",
    ]);
    expect(results[0]?.retrievedDirectly).toBe(true);
    expect(results[1]).toMatchObject({
      retrievedDirectly: false,
      relationshipDepth: 1,
      relationshipRank: 1,
    });
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

function metadata(
  chunkId: string,
  path: string,
  overrides: Partial<MemorySearchResult["sourceMetadata"]>,
): MemorySearchResult["sourceMetadata"] {
  const timestamp = new Date("2025-03-01T00:00:00.000Z");
  return {
    documentId: `document-${chunkId}`,
    chunkId,
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
    symbolId: `symbol-${chunkId}`,
    symbolName: null,
    symbolKind: null,
    parentSymbol: null,
    symbolPart: 1,
    symbolPartCount: 1,
    ...overrides,
  };
}
