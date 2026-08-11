import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import {
  chunkEmbeddings,
  createDatabase,
  documentChunks,
  documents,
  repositories,
  type Database,
} from "@swega/db";
import {
  normalizeIssueDocument,
  normalizeSourceCodeDocument,
} from "@swega/documents";
import { EMBEDDING_DIMENSIONS } from "@swega/shared";

import { persistMemoryDocuments } from "./repository-memory-persistence";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("repository-memory persistence", () => {
  let databaseConnection: ReturnType<typeof createDatabase>;
  let database: Database;
  let repositoryId: string;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    databaseConnection = createDatabase({ url: testDatabaseUrl });
    database = databaseConnection.db;
    const inserted = await database
      .insert(repositories)
      .values({
        provider: "test",
        providerId: crypto.randomUUID(),
        owner: "swega",
        name: `memory-${crypto.randomUUID()}`,
        url: "https://example.test/swega/memory",
      })
      .returning({ id: repositories.id });
    const row = inserted[0];
    if (!row) {
      throw new Error("Expected repository fixture");
    }
    repositoryId = row.id;
  });

  afterAll(async () => {
    if (database && repositoryId) {
      await database
        .delete(repositories)
        .where(eq(repositories.id, repositoryId));
    }
    if (databaseConnection) {
      await databaseConnection.close();
    }
  });

  test("re-indexes without duplicates and keeps temporal provenance", async () => {
    const occurredAt = new Date("2025-03-01T10:00:00.000Z");
    const availableAt = new Date("2025-03-20T10:00:00.000Z");
    const sourceEntityId = crypto.randomUUID();
    const generated = normalizeIssueDocument({
      repositoryId,
      sourceEntityId,
      sourceVersion: availableAt.toISOString(),
      sourceReference: "provider:test:issue:100",
      occurredAt,
      availableAt,
      number: 100,
      title: "Idempotent memory",
      body: "Persist this searchable content exactly once.",
      author: null,
      state: "open",
    });

    await persistMemoryDocuments(database, [generated], new Date());
    await persistMemoryDocuments(database, [generated], new Date());

    const storedDocuments = await database
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.repositoryId, repositoryId),
          eq(documents.sourceEntityId, sourceEntityId),
        ),
      );
    const storedChunks = await database
      .select()
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.repositoryId, repositoryId),
          eq(documentChunks.sourceEntityId, sourceEntityId),
        ),
      );

    expect(storedDocuments).toHaveLength(1);
    expect(storedChunks).toHaveLength(generated.chunks.length);
    expect(storedDocuments[0]).toMatchObject({
      repositoryId,
      sourceType: "issue",
      sourceEntityId,
      sourceReference: "provider:test:issue:100",
      occurredAt,
      availableAt,
    });
    expect(
      storedChunks.every(
        (chunk) =>
          chunk.repositoryId === repositoryId &&
          chunk.availableAt.getTime() === availableAt.getTime(),
      ),
    ).toBe(true);

    const nextAvailableAt = new Date("2025-04-01T10:00:00.000Z");
    const nextVersion = normalizeIssueDocument({
      repositoryId,
      sourceEntityId,
      sourceVersion: nextAvailableAt.toISOString(),
      sourceReference: "provider:test:issue:100",
      occurredAt,
      availableAt: nextAvailableAt,
      number: 100,
      title: "Idempotent memory",
      body: "This is the next searchable source version.",
      author: null,
      state: "closed",
    });
    await persistMemoryDocuments(database, [nextVersion], new Date());
    const versionedDocuments = await database
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.repositoryId, repositoryId),
          eq(documents.sourceEntityId, sourceEntityId),
        ),
      );
    const previous = versionedDocuments.find(
      (document) => document.id === generated.document.id,
    );
    const current = versionedDocuments.find(
      (document) => document.id === nextVersion.document.id,
    );

    expect(versionedDocuments).toHaveLength(2);
    expect(previous?.supersededAt).toEqual(nextAvailableAt);
    expect(current?.supersededAt).toBeNull();
  });

  test("rebuild removes stale source documents, chunks, and embeddings idempotently", async () => {
    const committedAt = new Date("2025-05-01T10:00:00.000Z");
    const commitSha = "d".repeat(40);
    const retained = normalizeSourceCodeDocument({
      repositoryId,
      sourceEntityId: crypto.randomUUID(),
      path: "src/retained.ts",
      commitSha,
      committedAt,
      content: "export const retained = true;",
      sourceReference: `git:${commitSha}:src/retained.ts`,
    });
    const excluded = normalizeSourceCodeDocument({
      repositoryId,
      sourceEntityId: crypto.randomUUID(),
      path: "dist/generated.js",
      commitSha,
      committedAt,
      content: "export const generated = true;",
      sourceReference: `git:${commitSha}:dist/generated.js`,
    });
    const persistenceOptions = {
      reconcileSourceCodeForRepositoryId: repositoryId,
    } as const;

    await persistMemoryDocuments(
      database,
      [retained, excluded],
      new Date(),
      persistenceOptions,
    );
    const excludedChunk = excluded.chunks[0];
    if (!excludedChunk) {
      throw new Error("Expected excluded source fixture chunk");
    }
    await database.insert(chunkEmbeddings).values({
      repositoryId,
      chunkId: excludedChunk.id,
      provider: "test",
      model: "test-model",
      dimensions: EMBEDDING_DIMENSIONS,
      contentHash: excludedChunk.contentHash,
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0),
    });

    const rebuilt = await persistMemoryDocuments(
      database,
      [retained],
      new Date(),
      persistenceOptions,
    );
    expect(rebuilt.reconciliation).toEqual({
      documentsRemoved: 1,
      chunksRemoved: excluded.chunks.length,
      embeddingsRemoved: 1,
    });

    const storedSourceDocuments = await database
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.repositoryId, repositoryId),
          eq(documents.sourceType, "source_code"),
        ),
      );
    const staleEmbeddings = await database
      .select({ chunkId: chunkEmbeddings.chunkId })
      .from(chunkEmbeddings)
      .where(eq(chunkEmbeddings.chunkId, excludedChunk.id));
    expect(storedSourceDocuments).toEqual([{ id: retained.document.id }]);
    expect(staleEmbeddings).toHaveLength(0);

    const repeated = await persistMemoryDocuments(
      database,
      [retained],
      new Date(),
      persistenceOptions,
    );
    expect(repeated.reconciliation).toEqual({
      documentsRemoved: 0,
      chunksRemoved: 0,
      embeddingsRemoved: 0,
    });
  });
});
