import { describe, expect, test } from "bun:test";

import type { AgentContextResponse } from "./types";
import { serializeAgentContextResponse } from "./serialization";

describe("Agent Context response serialization", () => {
  test("serializes Evidence Pack v1 deterministically with stable public provenance", () => {
    const response = fixtureResponse();
    const first = serializeAgentContextResponse(response);
    const second = serializeAgentContextResponse(response);
    expect(second).toBe(first);

    const parsed = JSON.parse(first) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      repository: {
        id: "123e4567-e89b-42d3-a456-426614174000",
        provider: "github",
        owner: "owner",
        name: "repo",
      },
      query: "How is authentication validated?",
      cutoff: "2025-03-15T00:00:00.000Z",
      revisions: ["abc123"],
      evidence: [
        {
          order: 1,
          contextRole: "PRIMARY",
          reasons: [{ kind: "retrieved_primary" }],
          source: {
            sourceType: "source_code",
            sourceReference: "git:abc123:src/auth.ts",
            path: "src/auth.ts",
            startLine: 10,
            endLine: 12,
            language: "TypeScript",
            symbolName: "authenticate",
            symbolKind: "function",
            sourceRole: "production_implementation",
          },
          retrieval: { rank: 1, exactSymbolMatch: true },
          relationships: [],
          content: "export function authenticate() {}",
        },
      ],
      budget: {
        maximumCharacters: 30_000,
        usedCharacters: 33,
      },
    });
    expect(first).not.toContain("documentId");
    expect(first).not.toContain("chunkId");
    expect(first).not.toContain("denseRank");
    expect(first).not.toContain("lexicalRank");
    expect(first).not.toContain("rrfRank");
    expect(first).not.toContain("similarity");
    expect(first).not.toContain("diagnostics");
  });
});

function fixtureResponse(): AgentContextResponse {
  const cutoff = new Date("2025-03-15T00:00:00.000Z");
  return {
    schemaVersion: 1,
    repository: {
      id: "123e4567-e89b-42d3-a456-426614174000",
      provider: "github",
      owner: "owner",
      name: "repo",
      url: "https://github.com/owner/repo",
      defaultBranch: "main",
    },
    query: "How is authentication validated?",
    cutoff,
    revisions: ["abc123"],
    intents: [
      {
        intent: "authentication",
        confidence: 0.9,
        evidence: ["authentication terminology"],
      },
    ],
    evidence: [
      {
        order: 1,
        contextRole: "PRIMARY",
        reasons: [{ kind: "retrieved_primary", detail: "selected at rank 1" }],
        source: {
          sourceType: "source_code",
          sourceReference: "git:abc123:src/auth.ts",
          parentSourceType: null,
          occurredAt: cutoff,
          availableAt: cutoff,
          path: "src/auth.ts",
          commitSha: "abc123",
          startLine: 10,
          endLine: 12,
          language: "TypeScript",
          symbolName: "authenticate",
          symbolKind: "function",
          parentSymbol: null,
          symbolPart: 1,
          symbolPartCount: 1,
          sourceRole: "production_implementation",
        },
        retrieval: { rank: 1, exactSymbolMatch: true },
        relationships: [],
        content: "export function authenticate() {}",
        contentCharacters: 33,
        originalContentCharacters: 33,
        truncated: false,
      },
    ],
    budget: {
      maximumCharacters: 30_000,
      usedCharacters: 33,
      remainingCharacters: 29_967,
      estimatedTokens: 9,
      truncatedItems: 0,
      rejectedItems: 0,
    },
  };
}
