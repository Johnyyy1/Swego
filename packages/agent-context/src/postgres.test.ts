import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  chunkEmbeddings,
  createDatabase,
  documentChunks,
  documents,
  repositories,
  repositoryFiles,
  type Database,
} from "@swega/db";
import { EMBEDDING_DIMENSIONS } from "@swega/shared";

import { PgAgentRepositoryStore } from "./postgres";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("PgAgentRepositoryStore", () => {
  let connection: ReturnType<typeof createDatabase>;
  let database: Database;
  let readyRepositoryId: string;
  let notReadyRepositoryId: string;
  const availableAt = new Date("2025-03-01T00:00:00.000Z");
  const provider = {
    provider: "test-embedding",
    model: "test-model",
    dimensions: EMBEDDING_DIMENSIONS,
  };

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
    connection = createDatabase({ url: testDatabaseUrl });
    database = connection.db;
    const suffix = crypto.randomUUID();
    const inserted = await database
      .insert(repositories)
      .values([
        {
          provider: "test",
          owner: `zeta-${suffix}`,
          name: "ready",
          url: `https://example.test/zeta-${suffix}/ready`,
          defaultBranch: "main",
          indexedAt: availableAt,
          gitIndexedAt: availableAt,
        },
        {
          provider: "test",
          owner: `alpha-${suffix}`,
          name: "not-ready",
          url: `https://example.test/alpha-${suffix}/not-ready`,
          defaultBranch: "main",
        },
      ])
      .returning({ id: repositories.id });
    readyRepositoryId = inserted[0]?.id ?? "";
    notReadyRepositoryId = inserted[1]?.id ?? "";
    if (!readyRepositoryId || !notReadyRepositoryId) {
      throw new Error("Expected repository fixtures");
    }

    const revision = "a".repeat(40);
    const documentId = `agent-context-document-${suffix}`;
    const chunkId = `agent-context-chunk-${suffix}`;
    const sourceEntityId = crypto.randomUUID();
    await database.insert(repositoryFiles).values({
      repositoryId: readyRepositoryId,
      path: "src/auth.ts",
      language: "TypeScript",
      extension: ".ts",
      size: 42,
      lastKnownCommitSha: revision,
      lastSyncedAt: availableAt,
    });
    await database.insert(documents).values({
      id: documentId,
      repositoryId: readyRepositoryId,
      sourceType: "source_code",
      sourceEntityId,
      sourceVersion: revision,
      sourceReference: `git:${revision}:src/auth.ts`,
      contentHash: "content-hash",
      chunkingStrategy: "source_code_structural_v1",
      occurredAt: availableAt,
      availableAt,
      path: "src/auth.ts",
      commitSha: revision,
      indexedAt: availableAt,
    });
    await database.insert(documentChunks).values({
      id: chunkId,
      documentId,
      repositoryId: readyRepositoryId,
      sourceType: "source_code",
      sourceEntityId,
      sourceReference: `git:${revision}:src/auth.ts`,
      chunkIndex: 0,
      content: "export function authenticate() { return true; }",
      language: "TypeScript",
      symbolId: `symbol-${suffix}`,
      symbolName: "authenticate",
      symbolKind: "function",
      symbolPart: 1,
      symbolPartCount: 1,
      contentHash: "content-hash",
      occurredAt: availableAt,
      availableAt,
      path: "src/auth.ts",
      commitSha: revision,
      startLine: 1,
      endLine: 1,
      indexedAt: availableAt,
    });
    await database.insert(chunkEmbeddings).values({
      repositoryId: readyRepositoryId,
      chunkId,
      provider: provider.provider,
      model: provider.model,
      dimensions: provider.dimensions,
      contentHash: "content-hash",
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) =>
        index === 0 ? 1 : 0,
      ),
      embeddedAt: availableAt,
    });
  });

  afterAll(async () => {
    if (database && readyRepositoryId) {
      await database
        .delete(repositories)
        .where(eq(repositories.id, readyRepositoryId));
    }
    if (database && notReadyRepositoryId) {
      await database
        .delete(repositories)
        .where(eq(repositories.id, notReadyRepositoryId));
    }
    if (connection) await connection.close();
  });

  test("returns deterministic metadata and configured readiness", async () => {
    const store = new PgAgentRepositoryStore(database, provider);
    const listed = await store.listRepositories();
    const fixtures = listed.filter((repository) =>
      [readyRepositoryId, notReadyRepositoryId].includes(
        repository.repositoryId,
      ),
    );
    expect(fixtures.map((repository) => repository.repositoryId)).toEqual([
      notReadyRepositoryId,
      readyRepositoryId,
    ]);
    expect(await store.getRepository(readyRepositoryId)).toMatchObject({
      repositoryId: readyRepositoryId,
      revision: "a".repeat(40),
      ready: true,
      memoryStatus: "ready",
      temporalCoverage: {
        earliestAvailableAt: availableAt,
        latestAvailableAt: availableAt,
      },
    });
    expect(await store.getRepository(notReadyRepositoryId)).toMatchObject({
      repositoryId: notReadyRepositoryId,
      revision: null,
      ready: false,
      memoryStatus: "not_ready",
      temporalCoverage: null,
    });
  });

  test("does not treat another embedding projection as ready", async () => {
    const store = new PgAgentRepositoryStore(database, {
      ...provider,
      model: "different-model",
    });
    expect(await store.getRepository(readyRepositoryId)).toMatchObject({
      ready: false,
      memoryStatus: "not_ready",
    });
  });

  test("returns null for a missing repository", async () => {
    const store = new PgAgentRepositoryStore(database, provider);
    expect(await store.getRepository(crypto.randomUUID())).toBeNull();
  });
});
