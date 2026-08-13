import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runProcess } from "../src/process.ts";
import { shouldRetryRun } from "../src/retry.ts";
import { parseRunResult } from "../src/schema.ts";
import { BENCHMARK_ROOT, SWEGA_ROOT } from "../src/paths.ts";
import {
  BENCHMARK_VERSION,
  CODEX_VERSION,
  SOURCE_REVISION,
} from "../src/config.ts";

describe("schema, timeout, and retry invariants", () => {
  test("publishes a stable run-result JSON schema", async () => {
    const schema = JSON.parse(
      await readFile(
        path.join(BENCHMARK_ROOT, "run-result.schema.json"),
        "utf8",
      ),
    ) as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required).toContain("verifierPassed");
    expect(schema.required).toContain("swegaMetrics");
    expect(schema.required).toContain("infrastructureFailure");
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(schema.required),
    );
  });

  test("rejects malformed serialized results", () => {
    expect(() =>
      parseRunResult({ schemaVersion: 1, condition: "C" }),
    ).toThrow();
    expect(() => parseRunResult({ schemaVersion: 2 })).toThrow();
  });

  test("round-trips an unavailable-metric-aware run result", () => {
    const serialized = JSON.stringify({
      schemaVersion: 1,
      benchmarkVersion: BENCHMARK_VERSION,
      taskId: "FB-F01",
      taskSet: "final",
      condition: "A",
      runOrder: 1,
      model: "gpt-5.6-sol",
      effort: "xhigh",
      codexVersion: CODEX_VERSION,
      sourceRevision: SOURCE_REVISION,
      startedAt: "2026-08-13T00:00:00.000Z",
      durationMs: 1,
      completionStatus: "completed",
      verifierPassed: false,
      testResults: [],
      filesModified: [],
      patchStats: {},
      toolMetrics: {},
      relevantFileMetrics: {},
      usageMetrics: {},
      swegaMetrics: {},
      infrastructureFailure: null,
      retryNumber: 0,
      transcriptArtifact: "transcript.jsonl",
      patchArtifact: "solver.patch",
      stderrArtifact: "stderr.txt",
      finalMessageArtifact: "final.txt",
      unavailableMetrics: ["timeToPassingVerifierMs"],
    });
    const result = parseRunResult(JSON.parse(serialized));
    expect(result.condition).toBe("A");
    expect(result.unavailableMetrics).toEqual(["timeToPassingVerifierMs"]);
  });

  test("times out a child process deterministically", async () => {
    const result = await runProcess({
      command: ["sh", "-c", "sleep 2"],
      cwd: SWEGA_ROOT,
      timeoutMs: 25,
    });
    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeLessThan(2_000);
  });

  test("retries only a verified infrastructure failure and only once", () => {
    expect(
      shouldRetryRun(
        {
          infrastructureFailure: {
            verified: true,
            kind: "service",
            detail: "down",
          },
        },
        0,
      ),
    ).toBe(true);
    expect(
      shouldRetryRun(
        {
          infrastructureFailure: {
            verified: true,
            kind: "service",
            detail: "down",
          },
        },
        1,
      ),
    ).toBe(false);
    expect(shouldRetryRun({ infrastructureFailure: null }, 0)).toBe(false);
  });
});
