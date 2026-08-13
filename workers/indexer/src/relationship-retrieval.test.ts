import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createDatabase, repositories, type Database } from "@swega/db";
import {
  extractSourceRelationships,
  normalizeSourceCodeDocument,
} from "@swega/documents";
import {
  PgRelationshipExpansion,
  type MemorySearchResult,
} from "@swega/retrieval";

import { persistMemoryDocuments } from "./repository-memory-persistence";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("relationship retrieval", () => {
  let connection: ReturnType<typeof createDatabase>;
  let database: Database;
  let repositoryId: string;
  let otherRepositoryId: string;
  let sourceAnchor: MemorySearchResult;
  let targetAnchor: MemorySearchResult;
  let aliasSourceAnchor: MemorySearchResult;
  let futureTargetSourceAnchor: MemorySearchResult;
  const availableAt = new Date("2025-03-10T12:00:00.000Z");

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
    connection = createDatabase({ url: testDatabaseUrl });
    database = connection.db;
    const inserted = await database
      .insert(repositories)
      .values({
        provider: "test",
        providerId: crypto.randomUUID(),
        owner: "swega",
        name: `relationships-${crypto.randomUUID()}`,
        url: "https://example.test/swega/relationships",
      })
      .returning({ id: repositories.id });
    repositoryId = inserted[0]?.id ?? "";
    const otherInserted = await database
      .insert(repositories)
      .values({
        provider: "test",
        providerId: crypto.randomUUID(),
        owner: "swega",
        name: `other-relationships-${crypto.randomUUID()}`,
        url: "https://example.test/swega/other-relationships",
      })
      .returning({ id: repositories.id });
    otherRepositoryId = otherInserted[0]?.id ?? "";
    const commitSha = "a".repeat(40);
    const helperContent =
      "export function authenticateRequest() { return true; }";
    const auditContent = "export function auditRequest() { return true; }";
    const wrapperContent = [
      'import { authenticateRequest } from "./authenticate-request";',
      'import { auditRequest } from "./audit";',
      "export function apiWrapper() { return authenticateRequest(); }",
    ].join("\n");
    const helper = normalizeSourceCodeDocument({
      repositoryId,
      sourceEntityId: crypto.randomUUID(),
      path: "src/authenticate-request.ts",
      commitSha,
      committedAt: availableAt,
      content: helperContent,
      sourceReference: `git:${commitSha}:src/authenticate-request.ts`,
    });
    const wrapper = normalizeSourceCodeDocument({
      repositoryId,
      sourceEntityId: crypto.randomUUID(),
      path: "src/api-wrapper.ts",
      commitSha,
      committedAt: availableAt,
      content: wrapperContent,
      sourceReference: `git:${commitSha}:src/api-wrapper.ts`,
    });
    const audit = normalizeSourceCodeDocument({
      repositoryId,
      sourceEntityId: crypto.randomUUID(),
      path: "src/audit.ts",
      commitSha,
      committedAt: availableAt,
      content: auditContent,
      sourceReference: `git:${commitSha}:src/audit.ts`,
    });
    const aliasConfigurationContent =
      '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}';
    const aliasConfiguration = normalizeSourceCodeDocument({
      repositoryId,
      sourceEntityId: crypto.randomUUID(),
      path: "tsconfig.json",
      commitSha,
      committedAt: new Date("2025-03-12T12:00:00.000Z"),
      content: aliasConfigurationContent,
      sourceReference: `git:${commitSha}:tsconfig.json`,
    });
    const aliasTargetContent = "export function aliasTarget() { return true; }";
    const aliasTarget = normalizeSourceCodeDocument({
      repositoryId,
      sourceEntityId: crypto.randomUUID(),
      path: "src/alias-target.ts",
      commitSha,
      committedAt: availableAt,
      content: aliasTargetContent,
      sourceReference: `git:${commitSha}:src/alias-target.ts`,
    });
    const aliasSourceContent = [
      'import { aliasTarget } from "@/alias-target";',
      "export function aliasConsumer() { return aliasTarget(); }",
    ].join("\n");
    const aliasSource = normalizeSourceCodeDocument({
      repositoryId,
      sourceEntityId: crypto.randomUUID(),
      path: "src/alias-consumer.ts",
      commitSha,
      committedAt: availableAt,
      content: aliasSourceContent,
      sourceReference: `git:${commitSha}:src/alias-consumer.ts`,
    });
    const futureTargetContent =
      "export function futureTarget() { return true; }";
    const futureTarget = normalizeSourceCodeDocument({
      repositoryId,
      sourceEntityId: crypto.randomUUID(),
      path: "src/future-target.ts",
      commitSha,
      committedAt: new Date("2025-03-14T12:00:00.000Z"),
      content: futureTargetContent,
      sourceReference: `git:${commitSha}:src/future-target.ts`,
    });
    const futureTargetSourceContent = [
      'import { futureTarget } from "./future-target";',
      "export function futureConsumer() { return futureTarget(); }",
    ].join("\n");
    const futureTargetSource = normalizeSourceCodeDocument({
      repositoryId,
      sourceEntityId: crypto.randomUUID(),
      path: "src/future-consumer.ts",
      commitSha,
      committedAt: availableAt,
      content: futureTargetSourceContent,
      sourceReference: `git:${commitSha}:src/future-consumer.ts`,
    });
    const relationships = extractSourceRelationships([
      { document: helper, content: helperContent },
      { document: audit, content: auditContent },
      { document: wrapper, content: wrapperContent },
      { document: aliasConfiguration, content: aliasConfigurationContent },
      { document: aliasTarget, content: aliasTargetContent },
      { document: aliasSource, content: aliasSourceContent },
      { document: futureTarget, content: futureTargetContent },
      {
        document: futureTargetSource,
        content: futureTargetSourceContent,
      },
    ]);
    await persistMemoryDocuments(
      database,
      [
        helper,
        audit,
        wrapper,
        aliasConfiguration,
        aliasTarget,
        aliasSource,
        futureTarget,
        futureTargetSource,
      ],
      new Date(),
      {
        reconcileSourceCodeForRepositoryId: repositoryId,
        sourceRelationships: relationships,
      },
    );
    const otherHelper = normalizeSourceCodeDocument({
      repositoryId: otherRepositoryId,
      sourceEntityId: crypto.randomUUID(),
      path: "src/authenticate-request.ts",
      commitSha,
      committedAt: availableAt,
      content: helperContent,
      sourceReference: `git:${commitSha}:src/authenticate-request.ts`,
    });
    const otherWrapper = normalizeSourceCodeDocument({
      repositoryId: otherRepositoryId,
      sourceEntityId: crypto.randomUUID(),
      path: "src/api-wrapper.ts",
      commitSha,
      committedAt: availableAt,
      content: wrapperContent,
      sourceReference: `git:${commitSha}:src/api-wrapper.ts`,
    });
    const otherRelationships = extractSourceRelationships([
      { document: otherHelper, content: helperContent },
      { document: otherWrapper, content: wrapperContent },
    ]);
    await persistMemoryDocuments(
      database,
      [otherHelper, otherWrapper],
      new Date(),
      {
        reconcileSourceCodeForRepositoryId: otherRepositoryId,
        sourceRelationships: otherRelationships,
      },
    );
    sourceAnchor = anchor(wrapper, "apiWrapper");
    targetAnchor = anchor(helper, "authenticateRequest");
    aliasSourceAnchor = anchor(aliasSource, "aliasConsumer");
    futureTargetSourceAnchor = anchor(futureTargetSource, "futureConsumer");
  });

  afterAll(async () => {
    if (database && repositoryId)
      await database
        .delete(repositories)
        .where(eq(repositories.id, repositoryId));
    if (database && otherRepositoryId)
      await database
        .delete(repositories)
        .where(eq(repositories.id, otherRepositoryId));
    if (connection) await connection.close();
  });

  test("expands a direct import to the exact symbol at depth one", async () => {
    const results = await expand(
      sourceAnchor,
      new Date("2025-03-11T00:00:00.000Z"),
    );
    expect(results[0]).toMatchObject({
      repositoryId,
      path: "src/authenticate-request.ts",
      relationshipType: "imports",
      relationshipDepth: 1,
      retrievedDirectly: false,
      sourceMetadata: { symbolName: "authenticateRequest" },
    });
    expect(
      results.every((result) => result.repositoryId === repositoryId),
    ).toBe(true);
    expect(results).toHaveLength(1);
  });

  test("materializes the reverse imported-by relationship without recursion", async () => {
    const results = await expand(
      targetAnchor,
      new Date("2025-03-11T00:00:00.000Z"),
    );
    expect(results[0]).toMatchObject({
      repositoryId,
      path: "src/api-wrapper.ts",
      relationshipType: "imported_by",
      relationshipDepth: 1,
    });
    expect(results).toHaveLength(1);
  });

  test("does not expose a relationship before its source snapshot", async () => {
    expect(
      await expand(sourceAnchor, new Date("2025-03-01T00:00:00.000Z")),
    ).toEqual([]);
  });

  test("does not expose an alias edge before the config snapshot", async () => {
    expect(
      await expand(aliasSourceAnchor, new Date("2025-03-11T00:00:00.000Z")),
    ).toEqual([]);
    expect(
      await expand(aliasSourceAnchor, new Date("2025-03-13T00:00:00.000Z")),
    ).toEqual([
      expect.objectContaining({
        path: "src/alias-target.ts",
        relationshipResolution: "exact_symbol",
        relationshipModuleResolutionKind: "path_alias",
        relationshipConfigurationPath: "tsconfig.json",
      }),
    ]);
  });

  test("does not expose an edge before the target snapshot", async () => {
    expect(
      await expand(
        futureTargetSourceAnchor,
        new Date("2025-03-13T00:00:00.000Z"),
      ),
    ).toEqual([]);
    expect(
      await expand(
        futureTargetSourceAnchor,
        new Date("2025-03-15T00:00:00.000Z"),
      ),
    ).toEqual([expect.objectContaining({ path: "src/future-target.ts" })]);
  });

  function expand(anchor: MemorySearchResult, before: Date) {
    return new PgRelationshipExpansion(database).expand({
      repositoryId,
      query: "authenticateRequest unauthorized request",
      before,
      anchors: [anchor],
      maxNeighborsPerAnchor: 1,
      candidateLimit: 1,
    });
  }
});

function anchor(
  document: ReturnType<typeof normalizeSourceCodeDocument>,
  symbolName: string,
): MemorySearchResult {
  const chunk = document.chunks.find(
    (candidate) => candidate.symbolName === symbolName,
  );
  if (!chunk) throw new Error(`Missing fixture symbol ${symbolName}`);
  return {
    repositoryId: chunk.repositoryId,
    content: chunk.content,
    similarity: 1,
    sourceType: chunk.sourceType,
    sourceId: chunk.sourceEntityId,
    timestamp: chunk.availableAt,
    path: chunk.path,
    retrievedDirectly: true,
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
