#!/usr/bin/env bun

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createPgAgentContextService } from "@swega/agent-context";
import { createDatabase } from "@swega/db";
import {
  loadRootEnvironment,
  parseServerEnvironment,
} from "@swega/shared/environment";
import { createJsonLogger, errorFields } from "@swega/shared/logging";

import { resolveMcpEmbeddingProvider, resolveMcpReranker } from "./providers";
import { createSwegaMcpServer } from "./server";

loadRootEnvironment();
const environment = parseServerEnvironment(process.env);
const logger = createJsonLogger(
  { application: "swega-mcp" },
  { destination: "stderr" },
);
const database = createDatabase({ url: environment.DATABASE_URL });
const reranker = resolveMcpReranker(environment);
const service = createPgAgentContextService({
  database: database.db,
  embeddings: resolveMcpEmbeddingProvider(environment),
  ...(reranker ? { reranker } : {}),
});
const handle = serveStdio(() => createSwegaMcpServer(service, logger), {
  onerror: (error) => logger.error("mcp.transport.failed", errorFields(error)),
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("mcp.shutdown.started", { signal });
  try {
    await handle.close();
  } finally {
    await database.close();
  }
  logger.info("mcp.shutdown.completed", { signal });
}

process.stdin.once("end", () => void shutdown("stdin_closed"));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}
