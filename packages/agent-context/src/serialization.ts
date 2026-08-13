import type { AgentContextResponse } from "./types";

/** Stable JSON serialization for the existing Evidence Pack v1 contract. */
export function serializeAgentContextResponse(
  response: AgentContextResponse,
  pretty = false,
): string {
  return JSON.stringify(response, null, pretty ? 2 : undefined);
}
