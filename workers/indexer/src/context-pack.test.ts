import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createDatabase, repositories, type Database } from "@swega/db";
import {
  extractSourceRelationships,
  normalizeSourceCodeDocument,
} from "@swega/documents";
import {
  EvidencePackBuilder,
  PgContextEvidenceSource,
  PgRelationshipExpansion,
  type MemorySearchResult,
  type RepositoryMemory,
} from "@swega/retrieval";

import { persistMemoryDocuments } from "./repository-memory-persistence";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const availableAt = new Date("2025-03-10T12:00:00.000Z");
const before = new Date("2025-03-11T00:00:00.000Z");

describeWithDatabase("Evidence Pack PostgreSQL expansion", () => {
  let connection: ReturnType<typeof createDatabase>;
  let database: Database;
  let repositoryId: string;
  let otherRepositoryId: string;
  let anchor: MemorySearchResult;

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
    connection = createDatabase({ url: testDatabaseUrl });
    database = connection.db;
    const inserted = await database
      .insert(repositories)
      .values([
        repositoryFixture("context-pack"),
        repositoryFixture("context-pack-other"),
      ])
      .returning({ id: repositories.id });
    const repository = inserted[0];
    const otherRepository = inserted[1];
    if (!repository || !otherRepository) {
      throw new Error("Expected two context repositories");
    }
    repositoryId = repository.id;
    otherRepositoryId = otherRepository.id;

    const implementationContent = [
      'import { SessionInput } from "./types";',
      'import { futureSession } from "./future";',
      "export class SessionService {",
      "  validate(input: SessionInput) { return input.active && Boolean(futureSession); }",
      "  refresh(input: SessionInput) { return this.validate(input); }",
      "}",
    ].join("\n");
    const typesContent =
      "export interface SessionInput { active: boolean; userId: string; }";
    const implementation = normalizeSourceCodeDocument({
      repositoryId,
      sourceEntityId: crypto.randomUUID(),
      path: "src/session-service.ts",
      commitSha: "a".repeat(40),
      committedAt: availableAt,
      content: implementationContent,
      sourceReference: `git:${"a".repeat(40)}:src/session-service.ts`,
    });
    const types = normalizeSourceCodeDocument({
      repositoryId,
      sourceEntityId: crypto.randomUUID(),
      path: "src/types.ts",
      commitSha: "a".repeat(40),
      committedAt: availableAt,
      content: typesContent,
      sourceReference: `git:${"a".repeat(40)}:src/types.ts`,
    });
    const future = normalizeSourceCodeDocument({
      repositoryId,
      sourceEntityId: crypto.randomUUID(),
      path: "src/future.ts",
      commitSha: "b".repeat(40),
      committedAt: new Date("2025-04-01T00:00:00.000Z"),
      content: "export function futureSession() { return true; }",
      sourceReference: `git:${"b".repeat(40)}:src/future.ts`,
    });
    const relationships = extractSourceRelationships([
      { document: implementation, content: implementationContent },
      { document: types, content: typesContent },
      {
        document: future,
        content: "export function futureSession() { return true; }",
      },
    ]);
    await persistMemoryDocuments(
      database,
      [implementation, types, future],
      new Date("2025-04-02T00:00:00.000Z"),
      {
        reconcileSourceCodeForRepositoryId: repositoryId,
        sourceRelationships: relationships,
      },
    );

    const other = normalizeSourceCodeDocument({
      repositoryId: otherRepositoryId,
      sourceEntityId: crypto.randomUUID(),
      path: "src/session-service.ts",
      commitSha: "c".repeat(40),
      committedAt: availableAt,
      content: implementationContent,
      sourceReference: `git:${"c".repeat(40)}:src/session-service.ts`,
    });
    await persistMemoryDocuments(database, [other], new Date());

    anchor = resultForSymbol(implementation, "validate");
  });

  afterAll(async () => {
    if (database && repositoryId) {
      await database
        .delete(repositories)
        .where(eq(repositories.id, repositoryId));
    }
    if (database && otherRepositoryId) {
      await database
        .delete(repositories)
        .where(eq(repositories.id, otherRepositoryId));
    }
    if (connection) await connection.close();
  });

  test("loads bounded structural parent and neighbor context", async () => {
    const source = new PgContextEvidenceSource(database);
    const local = await source.loadLocalContext({
      repositoryId,
      before,
      anchors: [anchor],
    });
    expect(local.length).toBeLessThanOrEqual(2);
    expect(
      local.some((candidate) => candidate.reason === "parent_symbol"),
    ).toBe(true);
    expect(
      local.some((candidate) => candidate.reason === "structural_neighbor"),
    ).toBe(true);
    expect(
      local.every(
        (candidate) => candidate.result.repositoryId === repositoryId,
      ),
    ).toBe(true);
    expect(
      local.some((candidate) => candidate.result.path === "src/future.ts"),
    ).toBe(false);
  });

  test("builds a historical pack with no future or cross-repository evidence", async () => {
    const memory: RepositoryMemory = { searchMemory: async () => [anchor] };
    const relationships = new PgRelationshipExpansion(database);
    const related = await relationships.expand({
      repositoryId,
      query: "validate SessionInput",
      before,
      anchors: [anchor],
      maxNeighborsPerAnchor: 2,
      candidateLimit: 2,
    });
    expect(related.map((item) => item.path)).toContain("src/types.ts");
    const pack = await new EvidencePackBuilder(
      memory,
      new PgContextEvidenceSource(database),
      relationships,
    ).build({
      repositoryId,
      query: "how is validate implemented and what type does it import",
      before,
      limit: 1,
      contextBudget: 10_000,
    });

    expect(pack.evidence.map((item) => item.source.path)).toContain(
      "src/types.ts",
    );
    expect(
      pack.evidence.some((item) => item.source.path === "src/future.ts"),
    ).toBe(false);
    expect(
      pack.evidence.every(
        (item) => item.source.availableAt.getTime() <= before.getTime(),
      ),
    ).toBe(true);
    expect(pack.revisions).toEqual(["a".repeat(40)]);
    expect(pack.repository.id).toBe(repositoryId);
  });
});

function repositoryFixture(name: string) {
  return {
    provider: "test",
    providerId: crypto.randomUUID(),
    owner: "swega",
    name: `${name}-${crypto.randomUUID()}`,
    url: `https://example.test/swega/${name}`,
    defaultBranch: "main",
  };
}

function resultForSymbol(
  document: ReturnType<typeof normalizeSourceCodeDocument>,
  symbolName: string,
): MemorySearchResult {
  const chunk = document.chunks.find(
    (candidate) => candidate.symbolName === symbolName,
  );
  if (!chunk) throw new Error(`Missing fixture symbol '${symbolName}'`);
  return {
    repositoryId: chunk.repositoryId,
    content: chunk.content,
    similarity: 1,
    sourceType: chunk.sourceType,
    sourceId: chunk.sourceEntityId,
    timestamp: chunk.availableAt,
    path: chunk.path,
    structuredExactMatch: true,
    finalRank: 1,
    sourceMetadata: {
      documentId: chunk.documentId,
      chunkId: chunk.id,
      sourceReference: chunk.sourceReference,
      parentSourceType: chunk.parentSourceType,
      parentSourceEntityId: chunk.parentSourceEntityId,
      occurredAt: chunk.occurredAt,
      availableAt: chunk.availableAt,
      path: chunk.path,
      commitSha: chunk.commitSha,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      language: chunk.language,
      symbolId: chunk.symbolId,
      symbolName: chunk.symbolName,
      symbolKind: chunk.symbolKind,
      parentSymbol: chunk.parentSymbol,
      symbolPart: chunk.symbolPart,
      symbolPartCount: chunk.symbolPartCount,
    },
  };
}
