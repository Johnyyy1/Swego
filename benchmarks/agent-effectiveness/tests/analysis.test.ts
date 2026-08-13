import { describe, expect, test } from "bun:test";
import { analyzeResults, exactMcNemarTwoSided } from "../src/analyze.ts";
import {
  BENCHMARK_VERSION,
  CODEX_VERSION,
  SOLVER_CONFIGURATION,
  SOURCE_REVISION,
} from "../src/config.ts";
import type { PublicTaskDefinition, RunResult } from "../src/types.ts";

const task = (index: number): PublicTaskDefinition => ({
  id: `T${String(index).padStart(2, "0")}`,
  set: "final",
  category: index <= 6 ? "one" : "two",
  difficulty: "medium",
  promptFile: "prompt.txt",
  promptSha256: "a".repeat(64),
});

const result = (
  definition: PublicTaskDefinition,
  condition: "A" | "B",
  passed: boolean,
): RunResult => ({
  schemaVersion: 1,
  benchmarkVersion: BENCHMARK_VERSION,
  taskId: definition.id,
  taskSet: "final",
  condition,
  runOrder: 1,
  model: SOLVER_CONFIGURATION.model,
  effort: SOLVER_CONFIGURATION.effort,
  codexVersion: CODEX_VERSION,
  sourceRevision: SOURCE_REVISION,
  startedAt: "2026-08-13T00:00:00.000Z",
  durationMs: condition === "A" ? 100 : 90,
  completionStatus: "completed",
  verifierPassed: passed,
  testResults: [],
  filesModified: [],
  patchStats: { filesChanged: 0, insertions: 0, deletions: 0 },
  toolMetrics: {
    fileReadOperations: condition === "A" ? 4 : 3,
    distinctFilesRead: [],
    searchOperations: 1,
    shellDiscoveryOperations: 0,
    commandExecutions: 1,
    fileChangeEvents: 0,
    timeToFirstFileReadMs: null,
    timeToFirstEditMs: null,
    fileReadEvents: [],
  },
  relevantFileMetrics: {
    relevantFiles: [],
    relevantFilesVisited: [],
    irrelevantFilesVisited: [],
    relevantFilesEdited: [],
    relevantFileRecall: null,
    timeToFirstRelevantFileMs: null,
  },
  usageMetrics: {
    inputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: 0,
    cacheWriteInputTokens: null,
    reasoningOutputTokens: 2,
    totalTokens: 15,
  },
  swegaMetrics: {
    available: condition === "B",
    used: condition === "B",
    mcpCallCount: condition === "B" ? 1 : 0,
    toolsCalled: [],
    getContextCount: condition === "B" ? 1 : 0,
    calls: [],
  },
  infrastructureFailure: null,
  retryNumber: 0,
  transcriptArtifact: "transcript.jsonl",
  patchArtifact: "solver.patch",
  stderrArtifact: "stderr.txt",
  finalMessageArtifact: "final.txt",
  unavailableMetrics: [],
});

describe("paired analysis", () => {
  test("computes paired outcomes, medians, and exact McNemar on synthetic results", () => {
    const tasks = Array.from({ length: 12 }, (_, index) => task(index + 1));
    const results = tasks.flatMap((definition, index) => [
      result(definition, "A", index >= 4),
      result(definition, "B", true),
    ]);
    const analysis = analyzeResults(results, tasks);
    expect(analysis.conditionSuccess).toEqual({ A: 8, B: 12 });
    expect(analysis.pairedOutcomeCounts["A-fail/B-pass"]).toBe(4);
    expect(analysis.exactMcNemarTwoSidedP).toBe(0.125);
    expect(analysis.medianPairedWallTimeDifferenceMs).toBe(-10);
    expect(analysis.medianPairedFileReadDifference).toBe(-1);
    expect(analysis.swega.getContextCalls).toBe(12);
  });

  test("returns one when there are no discordant pairs", () => {
    expect(exactMcNemarTwoSided(0, 0)).toBe(1);
  });
});
