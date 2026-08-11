import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import {
  createDatabase,
  documentChunks,
  documents,
  repositories,
  type Database,
} from "@swega/db";
import { normalizeIssueDocument } from "@swega/documents";

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
});
