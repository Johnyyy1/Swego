import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createDatabase, repositories, type Database } from "@swega/db";
import { normalizeIssueDocument } from "@swega/documents";
import { DeterministicEmbeddingProvider } from "@swega/embeddings/testing";
import {
  EmbeddingCompatibilityError,
  PgVectorRepositoryMemory,
} from "@swega/retrieval";
import { EMBEDDING_DIMENSIONS } from "@swega/shared";
import type { Logger } from "@swega/shared/logging";

import { embedRepositoryMemory } from "./embed-repository-memory";
import { persistMemoryDocuments } from "./repository-memory-persistence";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const cutoff = new Date("2025-03-15T00:00:00.000Z");

describeWithDatabase("repository memory retrieval", () => {
  let databaseConnection: ReturnType<typeof createDatabase>;
  let database: Database;
  let repositoryId: string;
  let otherRepositoryId: string;
  let pastSourceId: string;
  let futureSourceId: string;
  const embeddings = new DeterministicEmbeddingProvider();

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    databaseConnection = createDatabase({ url: testDatabaseUrl });
    database = databaseConnection.db;
    const inserted = await database
      .insert(repositories)
      .values([
        repositoryFixture("temporal-search"),
        repositoryFixture("isolated-search"),
      ])
      .returning({ id: repositories.id });
    const repository = inserted[0];
    const otherRepository = inserted[1];
    if (!repository || !otherRepository) {
      throw new Error("Expected two repository fixtures");
    }
    repositoryId = repository.id;
    otherRepositoryId = otherRepository.id;
    pastSourceId = crypto.randomUUID();
    futureSourceId = crypto.randomUUID();

    await persistMemoryDocuments(
      database,
      [
        issueDocument({
          repositoryId,
          sourceEntityId: pastSourceId,
          availableAt: new Date("2025-03-01T12:00:00.000Z"),
          title: "Authentication redirect baseline",
          body: "The login callback uses the stable redirect handler.",
        }),
        issueDocument({
          repositoryId,
          sourceEntityId: futureSourceId,
          availableAt: new Date("2025-04-01T12:00:00.000Z"),
          title: "Authentication redirect security fix",
          body: "Authentication redirect security fix future-only-token.",
        }),
        issueDocument({
          repositoryId: otherRepositoryId,
          sourceEntityId: crypto.randomUUID(),
          availableAt: new Date("2025-03-01T12:00:00.000Z"),
          title: "Authentication redirect security fix",
          body: "This exact match belongs to a different repository.",
        }),
      ],
      new Date("2025-04-02T00:00:00.000Z"),
    );
    await embedRepositoryMemory({
      database,
      embeddings,
      logger: silentLogger,
      repositoryId,
    });
    await embedRepositoryMemory({
      database,
      embeddings,
      logger: silentLogger,
      repositoryId: otherRepositoryId,
    });
  });

  afterAll(async () => {
    if (database && repositoryId && otherRepositoryId) {
      await database
        .delete(repositories)
        .where(eq(repositories.id, repositoryId));
      await database
        .delete(repositories)
        .where(eq(repositories.id, otherRepositoryId));
    }
    if (databaseConnection) {
      await databaseConnection.close();
    }
  });

  test("enforces repository and temporal isolation in the vector query", async () => {
    const memory = new PgVectorRepositoryMemory(database, embeddings);
    const results = await memory.searchMemory({
      repositoryId,
      query: "authentication redirect security fix future-only-token",
      limit: 10,
      before: cutoff,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every((result) => result.repositoryId === repositoryId),
    ).toBe(true);
    expect(
      results.every(
        (result) =>
          result.sourceMetadata.availableAt.getTime() <= cutoff.getTime(),
      ),
    ).toBe(true);
    expect(results.some((result) => result.sourceId === pastSourceId)).toBe(
      true,
    );
    expect(results.some((result) => result.sourceId === futureSourceId)).toBe(
      false,
    );
  });

  test("returns future material only when the cutoff permits it", async () => {
    const memory = new PgVectorRepositoryMemory(database, embeddings);
    const results = await memory.searchMemory({
      repositoryId,
      query: "future-only-token",
      limit: 10,
      before: new Date("2025-05-01T00:00:00.000Z"),
    });

    expect(results.some((result) => result.sourceId === futureSourceId)).toBe(
      true,
    );
  });

  test("re-embedding unchanged chunks is idempotent", async () => {
    const result = await embedRepositoryMemory({
      database,
      embeddings,
      logger: silentLogger,
      repositoryId,
    });

    expect(result.embedded).toBe(0);
    expect(result.skipped).toBe(result.chunks);
    expect(result.unchanged).toBeGreaterThan(0);
  });

  test("rejects search with an incompatible provider projection", async () => {
    const memory = new PgVectorRepositoryMemory(database, {
      provider: "another-provider",
      model: "another-model",
      dimensions: EMBEDDING_DIMENSIONS,
      embed: async () => {
        throw new Error(
          "Query embedding must not run before compatibility check",
        );
      },
    });

    await expect(
      memory.searchMemory({ repositoryId, query: "authentication" }),
    ).rejects.toBeInstanceOf(EmbeddingCompatibilityError);
  });
});

function repositoryFixture(name: string) {
  const identity = crypto.randomUUID();
  return {
    provider: "test",
    providerId: identity,
    owner: "swega",
    name: `${name}-${identity}`,
    url: `https://example.test/swega/${name}-${identity}`,
  };
}

function issueDocument(input: {
  repositoryId: string;
  sourceEntityId: string;
  availableAt: Date;
  title: string;
  body: string;
}) {
  return normalizeIssueDocument({
    ...input,
    sourceVersion: input.availableAt.toISOString(),
    sourceReference: `provider:test:issue:${input.sourceEntityId}`,
    occurredAt: input.availableAt,
    number: null,
    author: null,
    state: "open",
  });
}

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};
