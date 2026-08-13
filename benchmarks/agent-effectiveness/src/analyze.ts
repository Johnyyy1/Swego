import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BENCHMARK_VERSION, SOLVER_CONFIGURATION } from "./config.ts";
import { parseRunResult } from "./schema.ts";
import type {
  BenchmarkAnalysis,
  PairedOutcome,
  PublicTaskDefinition,
  RunResult,
} from "./types.ts";

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const current = ordered[middle];
  if (current === undefined) return null;
  if (ordered.length % 2 === 1) return current;
  const previous = ordered[middle - 1];
  return previous === undefined ? null : (previous + current) / 2;
};

const choose = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let index = 1; index <= Math.min(k, n - k); index += 1) {
    result = (result * (n - index + 1)) / index;
  }
  return result;
};

export const exactMcNemarTwoSided = (aOnly: number, bOnly: number): number => {
  const discordant = aOnly + bOnly;
  if (discordant === 0) return 1;
  const smaller = Math.min(aOnly, bOnly);
  let lowerTail = 0;
  for (let index = 0; index <= smaller; index += 1)
    lowerTail += choose(discordant, index) * 0.5 ** discordant;
  return Math.min(1, 2 * lowerTail);
};

const pairLabel = (A: boolean, B: boolean): PairedOutcome["outcome"] => {
  if (A && B) return "A-pass/B-pass";
  if (A) return "A-pass/B-fail";
  if (B) return "A-fail/B-pass";
  return "A-fail/B-fail";
};

export const analyzeResults = (
  results: RunResult[],
  tasks: PublicTaskDefinition[],
): BenchmarkAnalysis => {
  const finalTasks = tasks.filter((task) => task.set === "final");
  const finalTaskIds = new Set(finalTasks.map((task) => task.id));
  for (const result of results) {
    if (
      result.benchmarkVersion !== BENCHMARK_VERSION ||
      result.model !== SOLVER_CONFIGURATION.model ||
      result.effort !== SOLVER_CONFIGURATION.effort
    ) {
      throw new Error(
        `Incompatible frozen result: ${result.taskId}/${result.condition}`,
      );
    }
  }
  const effectiveResults = [
    ...new Map(
      results
        .filter(
          (result) =>
            result.taskSet === "final" && finalTaskIds.has(result.taskId),
        )
        .sort((left, right) => left.retryNumber - right.retryNumber)
        .map((result) => [`${result.taskId}:${result.condition}`, result]),
    ).values(),
  ];
  const unresolvedInfrastructure = effectiveResults.filter(
    (result) => result.completionStatus === "infrastructure_failure",
  );
  if (unresolvedInfrastructure.length > 0) {
    throw new Error(
      `Cannot analyze unresolved infrastructure failures: ${unresolvedInfrastructure
        .map((result) => `${result.taskId}/${result.condition}`)
        .join(", ")}`,
    );
  }
  const pairs: PairedOutcome[] = finalTasks.map((task) => {
    const A = effectiveResults.find(
      (result) => result.taskId === task.id && result.condition === "A",
    );
    const B = effectiveResults.find(
      (result) => result.taskId === task.id && result.condition === "B",
    );
    if (!A || !B) throw new Error(`Missing paired result for ${task.id}`);
    return {
      taskId: task.id,
      A: A.verifierPassed,
      B: B.verifierPassed,
      outcome: pairLabel(A.verifierPassed, B.verifierPassed),
      wallTimeDifferenceMs: B.durationMs - A.durationMs,
    };
  });
  const aOnly = pairs.filter((pair) => pair.outcome === "A-pass/B-fail").length;
  const bOnly = pairs.filter((pair) => pair.outcome === "A-fail/B-pass").length;
  const pairedDifferences = (
    select: (result: RunResult) => number | null,
  ): number[] =>
    finalTasks.flatMap((task) => {
      const A = effectiveResults.find(
        (result) => result.taskId === task.id && result.condition === "A",
      );
      const B = effectiveResults.find(
        (result) => result.taskId === task.id && result.condition === "B",
      );
      if (!A || !B) return [];
      const left = select(A);
      const right = select(B);
      return left === null || right === null ? [] : [right - left];
    });
  const categories = [...new Set(finalTasks.map((task) => task.category))]
    .sort()
    .map((category) => {
      const categoryTasks = finalTasks.filter(
        (task) => task.category === category,
      );
      const taskIds = new Set(categoryTasks.map((task) => task.id));
      return {
        category,
        A: effectiveResults.filter(
          (result) =>
            taskIds.has(result.taskId) &&
            result.condition === "A" &&
            result.verifierPassed,
        ).length,
        B: effectiveResults.filter(
          (result) =>
            taskIds.has(result.taskId) &&
            result.condition === "B" &&
            result.verifierPassed,
        ).length,
        tasks: categoryTasks.length,
      };
    });
  return {
    benchmarkVersion: BENCHMARK_VERSION,
    taskCount: finalTasks.length,
    conditionSuccess: {
      A: pairs.filter((pair) => pair.A).length,
      B: pairs.filter((pair) => pair.B).length,
    },
    absoluteSuccessDifference:
      pairs.filter((pair) => pair.B).length -
      pairs.filter((pair) => pair.A).length,
    pairedOutcomeCounts: {
      "A-pass/B-pass": pairs.filter((pair) => pair.outcome === "A-pass/B-pass")
        .length,
      "A-pass/B-fail": aOnly,
      "A-fail/B-pass": bOnly,
      "A-fail/B-fail": pairs.filter((pair) => pair.outcome === "A-fail/B-fail")
        .length,
    },
    discordantPairs: { AOnly: aOnly, BOnly: bOnly },
    exactMcNemarTwoSidedP: exactMcNemarTwoSided(aOnly, bOnly),
    medianPairedWallTimeDifferenceMs: median(
      pairs.map((pair) => pair.wallTimeDifferenceMs),
    ),
    medianPairedFileReadDifference: median(
      pairedDifferences((result) => result.toolMetrics.fileReadOperations),
    ),
    medianPairedSearchDifference: median(
      pairedDifferences((result) => result.toolMetrics.searchOperations),
    ),
    medianPairedRelevantFileRecallDifference: median(
      pairedDifferences(
        (result) => result.relevantFileMetrics.relevantFileRecall,
      ),
    ),
    medianPairedIrrelevantFileVisitDifference: median(
      pairedDifferences(
        (result) => result.relevantFileMetrics.irrelevantFilesVisited.length,
      ),
    ),
    medianPairedTotalTokenDifference: median(
      pairedDifferences((result) => result.usageMetrics.totalTokens),
    ),
    swega: {
      availableRuns: effectiveResults.filter(
        (result) => result.condition === "B",
      ).length,
      usedRuns: effectiveResults.filter(
        (result) => result.condition === "B" && result.swegaMetrics.used,
      ).length,
      unusedRuns: effectiveResults.filter(
        (result) => result.condition === "B" && !result.swegaMetrics.used,
      ).length,
      getContextCalls: effectiveResults
        .filter((result) => result.condition === "B")
        .reduce((sum, result) => sum + result.swegaMetrics.getContextCount, 0),
    },
    categories,
    pairs,
    caution:
      "Twelve paired tasks provide low statistical power; category results are directional only.",
  };
};

export const loadResults = async (directory: string): Promise<RunResult[]> => {
  const results: RunResult[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.name === "result.json")
        results.push(
          parseRunResult(JSON.parse(await readFile(target, "utf8"))),
        );
    }
  };
  await visit(directory);
  return results;
};

export const writeAnalysis = async (
  analysis: BenchmarkAnalysis,
  destination: string,
): Promise<void> => {
  await writeFile(destination, `${JSON.stringify(analysis, null, 2)}\n`, {
    flag: "wx",
  });
};
