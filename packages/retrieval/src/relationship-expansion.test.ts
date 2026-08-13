import { describe, expect, test } from "bun:test";

import {
  selectCandidatesWithRelationshipReserve,
  selectRelationshipAnchors,
} from "./relationship-expansion";
import { selectRepresentativeRelationshipChunk } from "./relationship-postgres";
import type { MemorySearchResult } from "./types";

describe("relationship expansion anchors", () => {
  test("uses only strong anchors and enforces a deterministic bound", () => {
    const candidates = [
      result("weak-1", {}),
      result("exact", { structuredExactMatch: true }),
      result("agreement", { denseRank: 3, lexicalRank: 4 }),
      result("file", { fileEvidenceSources: ["dense", "structured"] }),
      result("weak-2", {}),
      result("too-low", {}),
    ];

    expect(selectRelationshipAnchors(candidates, 3).map(id)).toEqual([
      "exact",
      "agreement",
      "file",
    ]);
  });

  test("never recursively promotes relationship-only candidates", () => {
    const candidates = Array.from({ length: 6 }, (_, index) =>
      result(`relationship-${index}`, {
        relationshipRank: index + 1,
        relationshipDepth: 1,
        retrievedDirectly: false,
      }),
    );
    expect(selectRelationshipAnchors(candidates)).toEqual([]);
  });

  test("selects the exact imported symbol instead of an arbitrary first chunk", () => {
    const chunks = [
      chunk("module", 0, null, "module"),
      chunk("helper", 1, "helper", "function"),
      chunk("authenticate", 2, "authenticateRequest", "function"),
    ];
    expect(
      selectRepresentativeRelationshipChunk(
        chunks,
        "authenticateRequest",
        new Set(["unauthorized"]),
      )?.id,
    ).toBe("authenticate");
  });

  test("does not treat a syntactic name as exact for module-only edges", () => {
    const chunks = [
      chunk("named", 1, "authenticateRequest", "function"),
      chunk("query", 2, "unauthorizedHandler", "function"),
    ];
    expect(
      selectRepresentativeRelationshipChunk(
        chunks,
        "authenticateRequest",
        new Set(["unauthorized", "handler"]),
        "exact_module",
      )?.id,
    ).toBe("query");
  });

  test("reserves a bounded pool slot for relationship-only evidence", () => {
    const direct = ["direct-1", "direct-2", "direct-3", "direct-4"].map(
      (chunkId, index) => result(chunkId, { rrfRank: index + 1 }),
    );
    const related = result("related", {
      rrfRank: 20,
      relationshipRank: 1,
      relationshipDepth: 1,
      retrievedDirectly: false,
    });
    const directIds = new Set(direct.map(id));

    expect(
      selectCandidatesWithRelationshipReserve([...direct, related], directIds, {
        limit: 3,
        maxCandidatesPerPath: 2,
        reservedRelationshipCandidates: 1,
      }).map(id),
    ).toEqual(["direct-1", "direct-2", "related"]);
  });

  test("does not displace an exact-symbol candidate for the relationship reserve", () => {
    const exact = result("exact", {
      rrfRank: 4,
      structuredExactMatch: true,
    });
    const direct = ["direct-1", "direct-2", "direct-3"].map((chunkId, index) =>
      result(chunkId, { rrfRank: index + 1 }),
    );
    const related = result("related", {
      rrfRank: 20,
      relationshipRank: 1,
      relationshipDepth: 1,
      retrievedDirectly: false,
    });

    expect(
      selectCandidatesWithRelationshipReserve(
        [...direct, exact, related],
        new Set([...direct, exact].map(id)),
        {
          limit: 3,
          maxCandidatesPerPath: 2,
          reservedRelationshipCandidates: 1,
        },
      ).map(id),
    ).toEqual(["direct-1", "exact", "related"]);
  });
});

function id(result: MemorySearchResult): string {
  return result.sourceMetadata.chunkId;
}

function chunk(
  id: string,
  chunkIndex: number,
  symbolName: string | null,
  symbolKind: "module" | "function",
) {
  return {
    id,
    chunkIndex,
    symbolName,
    symbolKind,
    parentSymbol: null,
  };
}

function result(
  chunkId: string,
  diagnostics: Partial<MemorySearchResult>,
): MemorySearchResult {
  const timestamp = new Date("2025-03-01T00:00:00.000Z");
  return {
    repositoryId: "123e4567-e89b-42d3-a456-426614174000",
    content: chunkId,
    similarity: 0,
    sourceType: "source_code",
    sourceId: "223e4567-e89b-42d3-a456-426614174000",
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
      endLine: 1,
      language: "TypeScript",
      symbolId: null,
      symbolName: null,
      symbolKind: null,
      parentSymbol: null,
      symbolPart: null,
      symbolPartCount: null,
    },
    ...diagnostics,
  };
}
