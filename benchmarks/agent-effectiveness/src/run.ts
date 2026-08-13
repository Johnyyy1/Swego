import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BENCHMARK_VERSION,
  CODEX_VERSION,
  SOLVER_CONFIGURATION,
  SOURCE_REVISION,
} from "./config.ts";
import { runCodex } from "./codex.ts";
import {
  collectSwegaMetrics,
  collectToolMetrics,
  collectUsageMetrics,
  parseMcpCalls,
} from "./events.ts";
import { collectGitMetrics } from "./git-metrics.ts";
import { RESULTS_ROOT, SWEGA_ROOT, TASKS_ROOT } from "./paths.ts";
import { loadFreezeManifest, loadPublicTasks } from "./schema.ts";
import type {
  BenchmarkCondition,
  CompletionStatus,
  RunResult,
  TaskSet,
} from "./types.ts";
import { gradeWorkspace } from "./verifier.ts";
import { createRunWorkspace } from "./workspace.ts";

const relativeArtifact = (absolutePath: string): string =>
  path.relative(SWEGA_ROOT, absolutePath);

export const classifyCompletion = (
  timedOut: boolean,
  exitCode: number | null,
  stderr: string,
  condition: BenchmarkCondition,
  events: Parameters<typeof parseMcpCalls>[0],
): {
  status: CompletionStatus;
  failure: RunResult["infrastructureFailure"];
} => {
  if (timedOut) return { status: "timed_out", failure: null };
  const mcpInfrastructureFailure =
    condition === "B" &&
    parseMcpCalls(events).some(
      (call) =>
        call.tool.startsWith("swega_") &&
        call.status !== "completed" &&
        /database unavailable|DATABASE_UNAVAILABLE|connection refused|embedding.*unavailable/i.test(
          JSON.stringify(call.result),
        ),
    );
  const structuredErrors = events
    .flatMap((entry) => {
      if (!entry.event || typeof entry.event !== "object") return [];
      const event = entry.event as {
        type?: unknown;
        message?: unknown;
        error?: { message?: unknown };
      };
      if (event.type !== "error" && event.type !== "turn.failed") return [];
      const message =
        typeof event.message === "string"
          ? event.message
          : typeof event.error?.message === "string"
            ? event.error.message
            : null;
      return message ? [message] : [];
    })
    .join("\n");
  const codexInfrastructurePattern =
    /usage limit|purchase more credits|response_too_many_failed_attempts|server overloaded|unauthorized|authentication/i;
  if (
    mcpInfrastructureFailure ||
    (condition === "B" &&
      /failed to start MCP|database unavailable/i.test(stderr))
  ) {
    return {
      status: "infrastructure_failure",
      failure: {
        verified: true,
        kind: "mcp-or-database",
        detail: mcpInfrastructureFailure
          ? "A structured SWEGA call reported a verified local infrastructure failure."
          : stderr.slice(0, 2_000),
      },
    };
  }
  if (exitCode === 0) return { status: "completed", failure: null };
  if (
    codexInfrastructurePattern.test(stderr) ||
    codexInfrastructurePattern.test(structuredErrors)
  ) {
    return {
      status: "infrastructure_failure",
      failure: {
        verified: true,
        kind: "codex-service",
        detail: (structuredErrors || stderr).slice(0, 2_000),
      },
    };
  }
  return { status: "codex_error", failure: null };
};

export const executeRun = async ({
  taskId,
  condition,
  runOrder,
  retryNumber,
  expectedSet,
}: {
  taskId: string;
  condition: BenchmarkCondition;
  runOrder: number;
  retryNumber: number;
  expectedSet: TaskSet;
}): Promise<RunResult> => {
  const tasks = await loadPublicTasks();
  const task = tasks.find((entry) => entry.id === taskId);
  if (!task || task.set !== expectedSet)
    throw new Error(`Unknown ${expectedSet} task: ${taskId}`);
  const manifest = task.set === "final" ? await loadFreezeManifest() : null;
  const prompt = await readFile(path.join(TASKS_ROOT, task.promptFile), "utf8");
  const resultDirectory = path.join(
    RESULTS_ROOT,
    task.set,
    taskId,
    condition,
    `attempt-${String(retryNumber)}`,
  );
  await mkdir(path.dirname(resultDirectory), { recursive: true });
  await mkdir(resultDirectory, { recursive: false });
  const workspace = await createRunWorkspace(taskId, condition, retryNumber);
  const startedAt = new Date().toISOString();
  const codex = await runCodex({
    condition,
    workspace,
    prompt,
    artifactDirectory: resultDirectory,
  });
  const patchArtifact = path.join(resultDirectory, "solver.patch");
  const { filesModified, patchStats } = await collectGitMetrics(
    workspace,
    patchArtifact,
  );
  const toolMetrics = collectToolMetrics(codex.events);
  const usageMetrics = collectUsageMetrics(codex.events);
  const graderDirectory = path.join(resultDirectory, "grader");
  const grade = await gradeWorkspace({
    workspace,
    taskId,
    artifactDirectory: graderDirectory,
  });
  const relevant = grade.task.relevantImplementationFiles;
  const relevantFilesVisited = relevant.filter((file) =>
    toolMetrics.distinctFilesRead.includes(file),
  );
  const relevantFilesEdited = relevant.filter((file) =>
    filesModified.includes(file),
  );
  const swegaMetrics = collectSwegaMetrics(
    condition,
    codex.events,
    toolMetrics.fileReadEvents,
    filesModified,
    relevant,
  );
  const relevantReadTimes = toolMetrics.fileReadEvents
    .filter(
      (entry) => relevant.includes(entry.path) && entry.elapsedMs !== null,
    )
    .map((entry) => entry.elapsedMs as number);
  const classified = classifyCompletion(
    codex.timedOut,
    codex.exitCode,
    await readFile(codex.stderrArtifact, "utf8"),
    condition,
    codex.events,
  );
  const result: RunResult = {
    schemaVersion: 1,
    benchmarkVersion: BENCHMARK_VERSION,
    taskId,
    taskSet: task.set,
    condition,
    runOrder,
    model: SOLVER_CONFIGURATION.model,
    effort: SOLVER_CONFIGURATION.effort,
    codexVersion: CODEX_VERSION,
    sourceRevision: SOURCE_REVISION,
    startedAt,
    durationMs: codex.durationMs,
    completionStatus: classified.status,
    verifierPassed: grade.passed,
    testResults: grade.testResults.map((entry) => ({
      ...entry,
      stdoutArtifact: relativeArtifact(entry.stdoutArtifact),
      stderrArtifact: relativeArtifact(entry.stderrArtifact),
    })),
    filesModified,
    patchStats,
    toolMetrics,
    relevantFileMetrics: {
      relevantFiles: relevant,
      relevantFilesVisited,
      irrelevantFilesVisited: toolMetrics.distinctFilesRead.filter(
        (file) => !relevant.includes(file),
      ),
      relevantFilesEdited,
      relevantFileRecall:
        relevant.length === 0
          ? null
          : relevantFilesVisited.length / relevant.length,
      timeToFirstRelevantFileMs:
        relevantReadTimes.length === 0 ? null : Math.min(...relevantReadTimes),
    },
    usageMetrics,
    swegaMetrics,
    infrastructureFailure: classified.failure,
    retryNumber,
    transcriptArtifact: relativeArtifact(codex.transcriptArtifact),
    patchArtifact: relativeArtifact(patchArtifact),
    stderrArtifact: relativeArtifact(codex.stderrArtifact),
    finalMessageArtifact: relativeArtifact(codex.finalMessageArtifact),
    unavailableMetrics: ["timeToPassingVerifierMs"],
  };
  if (manifest && manifest.benchmarkVersion !== result.benchmarkVersion)
    throw new Error("Benchmark version drift");
  await writeFile(
    path.join(resultDirectory, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { flag: "wx" },
  );
  return result;
};
