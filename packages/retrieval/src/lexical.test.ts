import { describe, expect, test } from "bun:test";

import type { Database } from "@swega/db";

import { PgLexicalRepositoryMemory } from "./lexical";

describe("PgLexicalRepositoryMemory", () => {
  test("returns ranked lexical candidates with provenance diagnostics", async () => {
    const repositoryId = "123e4567-e89b-42d3-a456-426614174000";
    const availableAt = new Date("2025-03-01T00:00:00.000Z");
    const database = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => [
                {
                  repositoryId,
                  documentId: "document-1",
                  chunkId: "chunk-1",
                  content: "export function getSession() {}",
                  lexicalScore: 1.5,
                  sourceType: "source_code",
                  sourceId: "123e4567-e89b-42d3-a456-426614174001",
                  sourceReference: "git:abc:src/session.ts",
                  parentSourceType: null,
                  parentSourceEntityId: null,
                  occurredAt: availableAt,
                  availableAt,
                  path: "src/session.ts",
                  commitSha: "abc",
                  startLine: 1,
                  endLine: 1,
                  language: "TypeScript",
                  symbolId: "symbol-1",
                  symbolName: "getSession",
                  symbolKind: "function",
                  parentSymbol: null,
                  symbolPart: 1,
                  symbolPartCount: 1,
                },
              ],
            }),
          }),
        }),
      }),
    } as unknown as Database;
    const memory = new PgLexicalRepositoryMemory(database);

    const results = await memory.searchMemory({
      repositoryId,
      query: "get session",
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      repositoryId,
      lexicalRank: 1,
      lexicalScore: 1.5,
      similarity: 0,
      path: "src/session.ts",
      sourceMetadata: {
        chunkId: "chunk-1",
        sourceReference: "git:abc:src/session.ts",
        language: "TypeScript",
        symbolId: "symbol-1",
        symbolName: "getSession",
        symbolKind: "function",
        parentSymbol: null,
        symbolPart: 1,
        symbolPartCount: 1,
      },
    });
  });
});
