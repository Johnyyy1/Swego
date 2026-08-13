import { describe, expect, test } from "bun:test";
import { classifyCompletion } from "../src/run.ts";
import type { TimestampedCodexEvent } from "../src/types.ts";

const event = (value: unknown): TimestampedCodexEvent => ({
  receivedAt: "2026-08-13T00:00:00.000Z",
  elapsedMs: 1,
  event: value,
});

describe("run completion classification", () => {
  test("treats a structured Codex usage limit as verified infrastructure failure", () => {
    const result = classifyCompletion(false, 1, "", "B", [
      event({
        type: "turn.failed",
        error: {
          message: "You've hit your usage limit. Purchase more credits.",
        },
      }),
    ]);
    expect(result.status).toBe("infrastructure_failure");
    expect(result.failure).toMatchObject({
      verified: true,
      kind: "codex-service",
    });
  });

  test("does not retry-classify a normal timeout or solver error", () => {
    expect(classifyCompletion(true, null, "", "A", []).status).toBe(
      "timed_out",
    );
    expect(
      classifyCompletion(false, 1, "ordinary failure", "A", []).status,
    ).toBe("codex_error");
  });

  test("treats a structured local SWEGA outage as verified infrastructure failure", () => {
    const result = classifyCompletion(false, 0, "", "B", [
      event({
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          id: "m1",
          tool: "swega_get_context",
          status: "failed",
          result: {
            structuredContent: { error: { code: "DATABASE_UNAVAILABLE" } },
          },
        },
      }),
    ]);
    expect(result.status).toBe("infrastructure_failure");
    expect(result.failure).toMatchObject({
      verified: true,
      kind: "mcp-or-database",
    });
  });
});
