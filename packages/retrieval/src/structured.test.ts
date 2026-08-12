import { describe, expect, test } from "bun:test";

import type { Database } from "@swega/db";

import {
  normalizeStructuralQuery,
  PgStructuredRepositoryMemory,
  structuralQueryTerms,
} from "./structured";

describe("structured metadata retrieval", () => {
  test("normalizes camelCase, PascalCase, kebab-case, snake_case, and paths", () => {
    expect(normalizeStructuralQuery("getProxySession")).toBe(
      "get proxy session",
    );
    expect(normalizeStructuralQuery("EndingCard")).toBe("ending card");
    expect(normalizeStructuralQuery("proxy-session.ts")).toBe(
      "proxy session ts",
    );
    expect(normalizeStructuralQuery("validate_v3_references")).toBe(
      "validate v3 references",
    );
    expect(normalizeStructuralQuery("modules/auth/provider.ts")).toBe(
      "modules auth provider ts",
    );
  });

  test("keeps code-oriented terms and removes natural-language framing", () => {
    expect(
      structuralQueryTerms(
        "how are unauthorized API requests handled and tested",
      ),
    ).toEqual([
      "unauthorized",
      "api",
      "requests",
      "handled",
      "tested",
      "request",
      "handl",
      "test",
    ]);
  });

  test("returns ranked structural candidates and tolerates null symbols", async () => {
    const repositoryId = "123e4567-e89b-42d3-a456-426614174000";
    const availableAt = new Date("2025-03-01T00:00:00.000Z");
    const database = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => [
                row({ repositoryId, availableAt }),
                row({
                  repositoryId,
                  availableAt,
                  chunkId: "chunk-module",
                  symbolId: "symbol-module",
                  symbolName: null,
                  symbolKind: "module",
                  exactMatch: false,
                }),
              ],
            }),
          }),
        }),
      }),
    } as unknown as Database;
    const memory = new PgStructuredRepositoryMemory(database);

    const results = await memory.searchMemory({
      repositoryId,
      query: "getProxySession",
    });

    expect(results[0]).toMatchObject({
      structuredRank: 1,
      structuredScore: 1.5,
      structuredExactMatch: true,
      path: "src/proxy-session.ts",
      sourceMetadata: {
        symbolName: "getProxySession",
        symbolKind: "function",
      },
    });
    expect(results[1]).toMatchObject({
      structuredRank: 2,
      structuredExactMatch: false,
      sourceMetadata: { symbolName: null, symbolKind: "module" },
    });
  });
});

function row(overrides: Record<string, unknown>) {
  const availableAt = new Date("2025-03-01T00:00:00.000Z");
  return {
    repositoryId: "123e4567-e89b-42d3-a456-426614174000",
    documentId: "document-1",
    chunkId: "chunk-1",
    content: "export function getProxySession() {}",
    structuredScore: 1.5,
    exactMatch: true,
    sourceType: "source_code",
    sourceId: "123e4567-e89b-42d3-a456-426614174001",
    sourceReference: "git:abc:src/proxy-session.ts",
    parentSourceType: null,
    parentSourceEntityId: null,
    occurredAt: availableAt,
    availableAt,
    path: "src/proxy-session.ts",
    commitSha: "abc",
    startLine: 1,
    endLine: 1,
    language: "TypeScript",
    symbolId: "symbol-1",
    symbolName: "getProxySession",
    symbolKind: "function",
    parentSymbol: null,
    symbolPart: 1,
    symbolPartCount: 1,
    ...overrides,
  };
}
