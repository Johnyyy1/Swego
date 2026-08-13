import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  AgentContextError,
  MAX_AGENT_CONTEXT_QUERY_CHARACTERS,
  mapAgentContextFailure,
  serializeAgentContextError,
  serializeAgentContextResponse,
  type AgentContextBuildOptions,
  type AgentContextRequest,
  type AgentContextResponse,
  type AgentRepository,
} from "@swega/agent-context";
import type { Logger } from "@swega/shared/logging";

export const SWEGA_MCP_SERVER_NAME = "swega";
export const SWEGA_MCP_SERVER_VERSION = "1.0.0";
export const SWEGA_MCP_TOOL_NAMES = [
  "swega_list_repositories",
  "swega_get_repository",
  "swega_get_context",
] as const;

export interface AgentContextApi {
  listRepositories(): Promise<readonly AgentRepository[]>;
  getRepository(repositoryId: string): Promise<AgentRepository>;
  buildContext(
    request: AgentContextRequest,
    options?: AgentContextBuildOptions,
  ): Promise<AgentContextResponse>;
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const repositoryIdInput = z
  .string()
  .min(1)
  .max(64)
  .describe("SWEGA repository UUID returned by swega_list_repositories.");

export function createSwegaMcpServer(
  service: AgentContextApi,
  logger: Logger,
): McpServer {
  const server = new McpServer(
    { name: SWEGA_MCP_SERVER_NAME, version: SWEGA_MCP_SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "SWEGA provides read-only repository intelligence. Discover repositories first, then request bounded evidence for an engineering question. It cannot edit files, execute commands, ingest repositories, or mutate memory.",
    },
  );

  server.registerTool(
    SWEGA_MCP_TOOL_NAMES[0],
    {
      title: "List SWEGA repositories",
      description:
        "Use this first to discover repositories registered in SWEGA and identify which have ready repository memory.",
      inputSchema: z.object({}).strict(),
      annotations: readOnlyAnnotations,
    },
    async () =>
      runTool(logger, { tool: SWEGA_MCP_TOOL_NAMES[0] }, async () => {
        const repositories = await service.listRepositories();
        return jsonToolResult({ repositories });
      }),
  );

  server.registerTool(
    SWEGA_MCP_TOOL_NAMES[1],
    {
      title: "Inspect a SWEGA repository",
      description:
        "Use this after discovery to inspect one repository's identity, indexed revision, memory readiness, and temporal coverage before requesting context.",
      inputSchema: z.object({ repositoryId: repositoryIdInput }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ repositoryId }) =>
      runTool(
        logger,
        { tool: SWEGA_MCP_TOOL_NAMES[1], repositoryId },
        async () =>
          jsonToolResult({
            repository: await service.getRepository(repositoryId),
          }),
      ),
  );

  server.registerTool(
    SWEGA_MCP_TOOL_NAMES[2],
    {
      title: "Retrieve SWEGA repository context",
      description:
        "Retrieve bounded repository evidence for understanding, debugging, modifying, or reasoning about code in an indexed repository. Ask an engineering question or describe the task; SWEGA returns relevant implementation context with provenance.",
      inputSchema: z
        .object({
          repositoryId: repositoryIdInput,
          query: z
            .string()
            .min(1)
            .max(MAX_AGENT_CONTEXT_QUERY_CHARACTERS)
            .describe("Engineering question or coding task to investigate."),
          before: z
            .string()
            .min(1)
            .max(64)
            .optional()
            .describe(
              "Optional ISO 8601 timestamp cutoff. All evidence must have been available at or before it.",
            ),
          contextBudget: z
            .number()
            .optional()
            .describe(
              "Optional Evidence Pack character budget. Defaults to 30000 and must stay within server bounds.",
            ),
          rerank: z
            .boolean()
            .optional()
            .describe(
              "Request the configured local reranker. False by default; failure is explicit if unavailable.",
            ),
        })
        .strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ repositoryId, query, before, contextBudget, rerank }) => {
      return runTool(
        logger,
        {
          tool: SWEGA_MCP_TOOL_NAMES[2],
          repositoryId,
          rerankRequested: rerank ?? false,
          temporalCutoffPresent: before !== undefined,
        },
        async () => {
          const request: AgentContextRequest = {
            repositoryId,
            query,
            ...(before ? { before: parseTemporalCutoff(before) } : {}),
            ...(contextBudget === undefined ? {} : { contextBudget }),
            ...(rerank === undefined ? {} : { rerank }),
          };
          const pack = await service.buildContext(request);
          return contextToolResult(pack);
        },
      );
    },
  );

  return server;
}

function parseTemporalCutoff(value: string): Date {
  const parsed = z.iso.datetime({ offset: true }).safeParse(value);
  if (!parsed.success) {
    throw new AgentContextError(
      "INVALID_TEMPORAL_CUTOFF",
      "before must be an ISO 8601 timestamp with a timezone.",
      { cause: parsed.error },
    );
  }
  return new Date(parsed.data);
}

async function runTool(
  logger: Logger,
  fields: Readonly<Record<string, unknown>>,
  operation: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const startedAt = performance.now();
  try {
    const result = await operation();
    const structured = result.structuredContent;
    const pack = isEvidencePackJson(structured) ? structured : null;
    logger.info("mcp.request.completed", {
      ...fields,
      durationMs: performance.now() - startedAt,
      success: true,
      ...(pack
        ? {
            evidenceItemCount: pack.evidence.length,
            contextCharacters: pack.budget.usedCharacters,
          }
        : {}),
    });
    return result;
  } catch (error) {
    const applicationError =
      error instanceof AgentContextError
        ? error
        : mapAgentContextFailure(error);
    logger.warn("mcp.request.completed", {
      ...fields,
      durationMs: performance.now() - startedAt,
      success: false,
      errorCode: applicationError.code,
    });
    return errorToolResult(applicationError);
  }
}

function contextToolResult(pack: AgentContextResponse): CallToolResult {
  const serialized = serializeAgentContextResponse(pack);
  return {
    content: [
      {
        type: "text",
        text: `Evidence Pack v${pack.schemaVersion} for ${pack.repository.owner}/${pack.repository.name}: ${pack.evidence.length} items, ${pack.budget.usedCharacters}/${pack.budget.maximumCharacters} characters. The complete pack is in structuredContent.`,
      },
    ],
    structuredContent: parseJsonObject(serialized),
  };
}

function jsonToolResult(value: Record<string, unknown>): CallToolResult {
  const serialized = JSON.stringify(value);
  return {
    content: [{ type: "text", text: serialized }],
    structuredContent: parseJsonObject(serialized),
  };
}

function errorToolResult(error: AgentContextError): CallToolResult {
  const payload = { error: serializeAgentContextError(error) };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("MCP structured content must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function isEvidencePackJson(value: unknown): value is Record<
  string,
  unknown
> & {
  evidence: unknown[];
  budget: { usedCharacters: number };
} {
  return (
    isRecord(value) &&
    Array.isArray(value.evidence) &&
    isRecord(value.budget) &&
    "usedCharacters" in value.budget &&
    typeof value.budget.usedCharacters === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
