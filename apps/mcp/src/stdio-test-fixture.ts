#!/usr/bin/env bun

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createJsonLogger } from "@swega/shared/logging";

import { createSwegaMcpServer } from "./server";
import { createFixtureAgentContextService } from "./test-support";

const logger = createJsonLogger(
  { application: "swega-mcp-test-fixture" },
  { destination: "stderr" },
);
const service = createFixtureAgentContextService();
const handle = serveStdio(() => createSwegaMcpServer(service, logger));

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await handle.close();
}

process.stdin.once("end", () => void close());
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void close().finally(() => process.exit(0)));
}
