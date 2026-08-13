import { afterEach, describe, expect, test } from "bun:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import type { LogFields, Logger } from "@swega/shared/logging";

import { createSwegaMcpServer, SWEGA_MCP_TOOL_NAMES } from "./server";
import {
  createFixtureAgentContextService,
  fixtureOtherRepositoryId,
  fixtureRepositoryId,
} from "./test-support";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

describe("SWEGA MCP server", () => {
  test("initializes and discovers exactly three read-only tools", async () => {
    const { client } = await connectClient();
    expect(client.getServerVersion()).toMatchObject({
      name: "swega",
      version: "1.0.0",
    });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([...SWEGA_MCP_TOOL_NAMES]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
    expect(tools[2]?.inputSchema).toMatchObject({
      required: ["repositoryId", "query"],
      additionalProperties: false,
    });
  });

  test("invokes repository discovery and inspection", async () => {
    const { client } = await connectClient();
    const listed = await client.callTool({
      name: SWEGA_MCP_TOOL_NAMES[0],
      arguments: {},
    });
    expect(listed.isError).not.toBe(true);
    expect(listed.structuredContent).toMatchObject({
      repositories: [
        {
          repositoryId: fixtureRepositoryId,
          name: "fixture/alpha",
          ready: true,
        },
        {
          repositoryId: fixtureOtherRepositoryId,
          name: "fixture/beta",
          ready: true,
        },
      ],
    });

    const inspected = await client.callTool({
      name: SWEGA_MCP_TOOL_NAMES[1],
      arguments: { repositoryId: fixtureRepositoryId },
    });
    expect(inspected.structuredContent).toMatchObject({
      repository: {
        repositoryId: fixtureRepositoryId,
        revision: "alpha-revision",
        memoryStatus: "ready",
      },
    });
  });

  test("returns a compact versioned Evidence Pack without ranking internals", async () => {
    const { client } = await connectClient();
    const result = await client.callTool({
      name: SWEGA_MCP_TOOL_NAMES[2],
      arguments: {
        repositoryId: fixtureRepositoryId,
        query: "How is authentication implemented?",
        contextBudget: 12_000,
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      schemaVersion: 1,
      repository: { id: fixtureRepositoryId, name: "alpha" },
      query: "How is authentication implemented?",
      budget: { maximumCharacters: 12_000 },
      evidence: [
        {
          contextRole: "PRIMARY",
          source: {
            path: "src/alpha/authentication.ts",
            symbolName: "authenticatealpha",
            sourceRole: "production_implementation",
          },
          retrieval: { rank: 1, exactSymbolMatch: true },
        },
      ],
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("denseRank");
    expect(JSON.stringify(result.structuredContent)).not.toContain("rrfRank");
  });

  test("preserves temporal cutoffs and repository isolation", async () => {
    const { client } = await connectClient();
    const before = "2025-02-01T00:00:00.000Z";
    const [alpha, beta] = await Promise.all([
      client.callTool({
        name: SWEGA_MCP_TOOL_NAMES[2],
        arguments: {
          repositoryId: fixtureRepositoryId,
          query: "authentication",
          before,
        },
      }),
      client.callTool({
        name: SWEGA_MCP_TOOL_NAMES[2],
        arguments: {
          repositoryId: fixtureOtherRepositoryId,
          query: "authentication",
          before: "2025-02-15T00:00:00.000Z",
        },
      }),
    ]);
    expect(alpha.structuredContent).toMatchObject({
      repository: { id: fixtureRepositoryId },
      cutoff: before,
      evidence: [{ source: { path: "src/alpha/authentication.ts" } }],
    });
    expect(beta.structuredContent).toMatchObject({
      repository: { id: fixtureOtherRepositoryId },
      evidence: [{ source: { path: "src/beta/authentication.ts" } }],
    });
    expect(JSON.stringify(alpha.structuredContent)).not.toContain("src/beta/");
    expect(JSON.stringify(beta.structuredContent)).not.toContain("src/alpha/");
  });

  test("maps application errors to structured tool failures", async () => {
    const { client } = await connectClient();
    const cases = [
      {
        arguments: { repositoryId: fixtureRepositoryId, query: "   " },
        code: "INVALID_QUERY",
      },
      {
        arguments: {
          repositoryId: fixtureRepositoryId,
          query: "question",
          contextBudget: 100,
        },
        code: "INVALID_CONTEXT_BUDGET",
      },
      {
        arguments: {
          repositoryId: fixtureRepositoryId,
          query: "question",
          before: "bad",
        },
        code: "INVALID_TEMPORAL_CUTOFF",
      },
      {
        arguments: {
          repositoryId: "323e4567-e89b-42d3-a456-426614174000",
          query: "question",
        },
        code: "REPOSITORY_NOT_FOUND",
      },
      {
        arguments: {
          repositoryId: fixtureRepositoryId,
          query: "question",
          rerank: true,
        },
        code: "RERANKER_UNAVAILABLE",
      },
    ];
    for (const entry of cases) {
      const result = await client.callTool({
        name: SWEGA_MCP_TOOL_NAMES[2],
        arguments: entry.arguments,
      });
      expect(result.isError).toBe(true);
      const content = result.content[0];
      expect(content).toMatchObject({ type: "text" });
      const payload = JSON.parse(
        content?.type === "text" ? content.text : "{}",
      ) as { error?: { code?: string } };
      expect(payload).toMatchObject({ error: { code: entry.code } });
      expect(JSON.stringify(payload)).not.toContain("stack");
    }
  });

  test("rejects malformed protocol input before invoking a handler", async () => {
    const { client } = await connectClient();
    const result = await client.callTool({
      name: SWEGA_MCP_TOOL_NAMES[2],
      arguments: { repositoryId: fixtureRepositoryId },
    });
    expect(result.isError).toBe(true);
  });

  test("logs bounded metadata to the injected logger", async () => {
    const entries: Array<{ event: string; fields?: LogFields }> = [];
    const { client } = await connectClient(recordingLogger(entries));
    await client.callTool({
      name: SWEGA_MCP_TOOL_NAMES[2],
      arguments: {
        repositoryId: fixtureRepositoryId,
        query: "authentication",
      },
    });
    expect(entries).toContainEqual({
      event: "mcp.request.completed",
      fields: expect.objectContaining({
        tool: SWEGA_MCP_TOOL_NAMES[2],
        repositoryId: fixtureRepositoryId,
        success: true,
        evidenceItemCount: 1,
      }),
    });
    expect(JSON.stringify(entries)).not.toContain("export function");
  });
});

async function connectClient(logger: Logger = recordingLogger([])) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createSwegaMcpServer(
    createFixtureAgentContextService(),
    logger,
  );
  const client = new Client({ name: "swega-mcp-test", version: "1.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  cleanup.push(async () => {
    await Promise.allSettled([client.close(), server.close()]);
  });
  return { client, server };
}

function recordingLogger(
  entries: Array<{ event: string; fields?: LogFields }>,
  base: LogFields = {},
): Logger {
  const record = (event: string, fields?: LogFields) =>
    entries.push({
      event,
      ...(fields ? { fields: { ...base, ...fields } } : {}),
    });
  return {
    debug: record,
    info: record,
    warn: record,
    error: record,
    child: (fields) => recordingLogger(entries, { ...base, ...fields }),
  };
}
