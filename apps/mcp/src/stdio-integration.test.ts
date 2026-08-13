import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { SWEGA_MCP_TOOL_NAMES } from "./server";
import { fixtureOtherRepositoryId, fixtureRepositoryId } from "./test-support";

describe("SWEGA MCP stdio integration", () => {
  test("serves read-only repository discovery and temporal Evidence Packs", async () => {
    const appDirectory = resolve(import.meta.dir, "..");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["src/stdio-test-fixture.ts"],
      cwd: appDirectory,
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const client = new Client({
      name: "swega-stdio-integration-test",
      version: "1.0.0",
    });
    const startupStartedAt = performance.now();
    await client.connect(transport);
    const startupDurationMs = performance.now() - startupStartedAt;
    const pid = transport.pid;
    expect(pid).not.toBeNull();

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([...SWEGA_MCP_TOOL_NAMES]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(
      true,
    );

    const listStartedAt = performance.now();
    const repositories = await client.callTool({
      name: SWEGA_MCP_TOOL_NAMES[0],
      arguments: {},
    });
    const listDurationMs = performance.now() - listStartedAt;
    expect(repositories.structuredContent).toMatchObject({
      repositories: [
        { repositoryId: fixtureRepositoryId },
        { repositoryId: fixtureOtherRepositoryId },
      ],
    });

    const contextStartedAt = performance.now();
    const context = await client.callTool({
      name: SWEGA_MCP_TOOL_NAMES[2],
      arguments: {
        repositoryId: fixtureRepositoryId,
        query: "How is authentication implemented?",
        before: "2025-02-01T00:00:00.000Z",
      },
    });
    const contextDurationMs = performance.now() - contextStartedAt;
    expect(context.isError).not.toBe(true);
    expect(context.structuredContent).toMatchObject({
      schemaVersion: 1,
      repository: { id: fixtureRepositoryId },
      cutoff: "2025-02-01T00:00:00.000Z",
      evidence: [
        {
          source: {
            path: "src/alpha/authentication.ts",
            availableAt: "2025-02-01T00:00:00.000Z",
          },
        },
      ],
    });
    expect(JSON.stringify(context.structuredContent)).not.toContain(
      "src/beta/",
    );

    const payloadBytes = Buffer.byteLength(
      JSON.stringify(context.structuredContent),
      "utf8",
    );
    expect(startupDurationMs).toBeLessThan(2_000);
    expect(listDurationMs).toBeLessThan(500);
    expect(contextDurationMs).toBeLessThan(500);
    expect(payloadBytes).toBeGreaterThan(0);

    await client.close();
    if (pid !== null) await expectProcessExit(pid);
    expect(stderr).not.toContain("export function");
  }, 10_000);
});

async function expectProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await Bun.sleep(20);
  }
  throw new Error(`MCP child process ${pid} did not exit`);
}
