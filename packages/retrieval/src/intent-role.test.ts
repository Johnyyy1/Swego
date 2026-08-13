import { describe, expect, test } from "bun:test";

import { applyIntentRolePrior } from "./intent-role";
import { analyzeQueryIntent } from "./query-intent";
import type { MemorySearchResult } from "./types";

describe("applyIntentRolePrior", () => {
  test.each([
    [
      "where is session handling implemented",
      "src/session.ts",
      "src/session.test.ts",
    ],
    [
      "where is session handling tested",
      "src/session.test.ts",
      "src/session.ts",
    ],
    [
      "where is the session database schema",
      "database/schema.prisma",
      "src/session.ts",
    ],
    ["where is session configuration", "src/env.ts", "src/session.ts"],
  ] as const)(
    "adds the expected weak preference for %s",
    (query, preferred, other) => {
      const ranked = applyIntentRolePrior(
        [result("other", other, 1), result("preferred", preferred, 2)],
        analyzeQueryIntent(query),
        { strategy: "weak" },
      );

      expect(ranked[0]?.path).toBe(preferred);
      expect(ranked[0]?.roleCompatibility).toBeGreaterThan(
        ranked[1]?.roleCompatibility ?? 0,
      );
      expect(ranked[0]?.roleCompatibilityReason).toContain("prefers");
    },
  );

  test("cannot erase stronger multi-branch relevance", () => {
    const strongTest = result("strong-test", "src/session.test.ts", 1, 0.05);
    const weakImplementation = result("weak-code", "src/session.ts", 2, 0.01);
    const ranked = applyIntentRolePrior(
      [strongTest, weakImplementation],
      analyzeQueryIntent("session implementation"),
      { strategy: "weak" },
    );

    expect(ranked.map((item) => item.path)).toEqual([
      "src/session.test.ts",
      "src/session.ts",
    ]);
  });

  test("does not filter incompatible or unknown evidence", () => {
    const ranked = applyIntentRolePrior(
      [
        result("test", "src/session.test.ts", 1),
        result("unknown", "data/session.json", 2),
        result("code", "src/session.ts", 3),
      ],
      analyzeQueryIntent("session implementation"),
    );

    expect(ranked).toHaveLength(3);
    expect(ranked.map((item) => item.sourceMetadata.chunkId)).toEqual(
      expect.arrayContaining(["test", "unknown", "code"]),
    );
  });

  test("keeps simultaneous test and configuration roles eligible", () => {
    const ranked = applyIntentRolePrior(
      [
        result("test", "src/session.test.ts", 1),
        result("config", "src/env.ts", 2),
        result("code", "src/session.ts", 3),
      ],
      analyzeQueryIntent("where is the session configured and tested"),
    );

    expect(
      ranked
        .filter((item) => item.intentRoleRank !== undefined)
        .map((item) => item.sourceRole),
    ).toEqual(["unit_test", "configuration"]);
  });

  test("preserves file evidence and distinct chunks from one file", () => {
    const representative = result("representative", "src/session.ts", 1);
    representative.fileEvidenceRank = 1;
    representative.fileEvidenceSources = ["dense", "structured"];
    representative.propagatedFromFileEvidence = true;
    const sibling = result("sibling", "src/session.ts", 2);

    const ranked = applyIntentRolePrior(
      [representative, sibling],
      analyzeQueryIntent("session implementation"),
    );

    expect(ranked).toHaveLength(2);
    expect(ranked[0]).toMatchObject({
      fileEvidenceRank: 1,
      fileEvidenceSources: ["dense", "structured"],
      propagatedFromFileEvidence: true,
    });
    expect(ranked.map((item) => item.sourceMetadata.chunkId)).toEqual([
      "representative",
      "sibling",
    ]);
  });

  test("preserves exact symbols and annotates query/source diagnostics", () => {
    const exact = result("exact", "src/session.ts", 2);
    exact.structuredExactMatch = true;
    exact.sourceMetadata.symbolName = "getSession";
    const ranked = applyIntentRolePrior(
      [result("other", "src/other.ts", 1), exact],
      analyzeQueryIntent("getSession"),
    );

    expect(ranked[0]).toMatchObject({
      path: "src/session.ts",
      roleCompatibility: 1,
      sourceRole: "production_implementation",
      sourceRoleEvidence: [expect.any(String)],
      queryIntents: [expect.objectContaining({ intent: "exact_symbol" })],
    });
  });

  test("keeps deterministic ties and exposes the disabled counterfactual", () => {
    const candidates = [result("b", "src/b.ts", 1), result("a", "src/a.ts", 1)];
    const signals = analyzeQueryIntent("implementation");
    const first = applyIntentRolePrior(candidates, signals, {
      strategy: "none",
    });
    const second = applyIntentRolePrior(candidates, signals, {
      strategy: "none",
    });

    expect(first).toEqual(second);
    expect(first.every((item) => item.intentRoleScore === 0)).toBe(true);
    expect(first.map((item) => item.rrfRankBeforeIntentRole)).toEqual([1, 1]);
  });
});

function result(
  chunkId: string,
  path: string,
  rrfRank: number,
  rrfScore = 1 / (60 + rrfRank),
): MemorySearchResult {
  const timestamp = new Date("2025-03-01T00:00:00.000Z");
  return {
    repositoryId: "123e4567-e89b-42d3-a456-426614174000",
    content: chunkId,
    similarity: 0,
    sourceType: "source_code",
    sourceId: "123e4567-e89b-42d3-a456-426614174001",
    timestamp,
    path,
    rrfRank,
    rrfScore,
    sourceMetadata: {
      documentId: `document-${chunkId}`,
      chunkId,
      sourceReference: `git:fixture:${path}`,
      parentSourceType: null,
      parentSourceEntityId: null,
      occurredAt: timestamp,
      availableAt: timestamp,
      path,
      commitSha: "fixture",
      startLine: 1,
      endLine: 10,
      language: "typescript",
      symbolId: null,
      symbolName: null,
      symbolKind: "function",
      parentSymbol: null,
      symbolPart: 1,
      symbolPartCount: 1,
    },
  };
}
