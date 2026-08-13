import { describe, expect, test } from "bun:test";
import {
  collectSwegaMetrics,
  collectToolMetrics,
  collectUsageMetrics,
} from "../src/events.ts";
import type { TimestampedCodexEvent } from "../src/types.ts";

const event = (elapsedMs: number, value: unknown): TimestampedCodexEvent => ({
  receivedAt: "2026-08-13T00:00:00.000Z",
  elapsedMs,
  event: value,
});

describe("structured Codex event parsing", () => {
  test("counts operations and distinct files with documented repetition semantics", () => {
    const events = [
      event(10, {
        type: "item.started",
        item: {
          type: "command_execution",
          id: "1",
          command: "sed -n '1,20p' packages/a.ts",
        },
      }),
      event(20, {
        type: "item.completed",
        item: {
          type: "command_execution",
          id: "1",
          command: "sed -n '1,20p' packages/a.ts",
          exit_code: 0,
          aggregated_output: "",
        },
      }),
      event(30, {
        type: "item.started",
        item: {
          type: "command_execution",
          id: "2",
          command: "cat packages/a.ts packages/b.ts",
        },
      }),
      event(40, {
        type: "item.completed",
        item: {
          type: "command_execution",
          id: "2",
          command: "cat packages/a.ts packages/b.ts",
          exit_code: 0,
          aggregated_output: "",
        },
      }),
      event(50, {
        type: "item.started",
        item: {
          type: "command_execution",
          id: "3",
          command: "rg symbol packages | head -n 20",
        },
      }),
      event(60, {
        type: "item.completed",
        item: {
          type: "command_execution",
          id: "3",
          command: "rg symbol packages | head -n 20",
          exit_code: 0,
          aggregated_output: "packages/c.ts:1:symbol",
        },
      }),
      event(70, {
        type: "item.completed",
        item: { type: "file_change", id: "4" },
      }),
      event(80, {
        type: "turn.completed",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cached_input_tokens: 5,
          reasoning_output_tokens: 7,
        },
      }),
    ];
    const metrics = collectToolMetrics(events);
    expect(metrics.fileReadOperations).toBe(2);
    expect(metrics.distinctFilesRead).toEqual([
      "packages/a.ts",
      "packages/b.ts",
    ]);
    expect(
      metrics.fileReadEvents.filter((entry) => entry.path === "packages/a.ts"),
    ).toHaveLength(2);
    expect(metrics.searchOperations).toBe(1);
    expect(metrics.timeToFirstFileReadMs).toBe(10);
    expect(metrics.timeToFirstEditMs).toBe(70);
    expect(collectUsageMetrics(events).totalTokens).toBe(120);
  });

  test("collects successful SWEGA context evidence without inventing unavailable values", () => {
    const events = [
      event(100, {
        type: "item.started",
        item: { type: "mcp_tool_call", id: "m1", tool: "swega_get_context" },
      }),
      event(150, {
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          id: "m1",
          tool: "swega_get_context",
          arguments: { query: "where is setup configured" },
          status: "completed",
          result: {
            structuredContent: {
              evidence: [
                { source: { path: "packages/a.ts" } },
                { source: { path: "packages/b.ts" } },
              ],
              budget: { usedCharacters: 1234 },
            },
          },
        },
      }),
    ];
    const metrics = collectSwegaMetrics(
      "B",
      events,
      [{ path: "packages/a.ts", elapsedMs: 170 }],
      ["packages/b.ts"],
      ["packages/a.ts"],
    );
    expect(metrics.used).toBe(true);
    expect(metrics.getContextCount).toBe(1);
    expect(metrics.calls[0]?.evidenceItemCount).toBe(2);
    expect(metrics.calls[0]?.contextCharacters).toBe(1234);
    expect(metrics.calls[0]?.relevantFilesSurfaced).toEqual(["packages/a.ts"]);
    expect(metrics.calls[0]?.surfacedFilesLaterOpened).toEqual([
      "packages/a.ts",
    ]);
    expect(metrics.calls[0]?.surfacedFilesEdited).toEqual(["packages/b.ts"]);
  });
});
