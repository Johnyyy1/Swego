import type {
  BenchmarkCaseReport,
  RetrievalBenchmarkReport,
  StrategyBenchmarkReport,
} from "./evaluate";
import type { RelevanceTarget } from "./schema";

export function formatBenchmarkReport(
  report: RetrievalBenchmarkReport,
): string {
  const lines = [
    `SWEGA retrieval benchmark: ${report.benchmark}`,
    ...(report.description ? [report.description] : []),
    `Cases: ${report.caseCount} | Cutoffs: ${report.cutoffs.map((cutoff) => `@${cutoff}`).join(", ")}`,
    "",
    formatTable([
      ["Strategy", "MRR"],
      ...report.strategies.map((strategy) => [
        strategy.strategy,
        formatMetric(strategy.aggregate.mrr),
      ]),
    ]),
  ];

  for (const cutoff of report.cutoffs) {
    const key = String(cutoff);
    lines.push(
      "",
      `Metrics @${cutoff}`,
      formatTable([
        ["Strategy", "Precision", "Recall", "Hit Rate", "nDCG"],
        ...report.strategies.map((strategy) => {
          const metrics = strategy.aggregate.at[key];
          return [
            strategy.strategy,
            formatMetric(metrics?.precision ?? 0),
            formatMetric(metrics?.recall ?? 0),
            formatMetric(metrics?.hitRate ?? 0),
            formatMetric(metrics?.ndcg ?? 0),
          ];
        }),
      ]),
    );
  }

  const maximumCutoff = Math.max(...report.cutoffs);
  const failures = report.strategies.flatMap((strategy) =>
    strategy.cases
      .filter((benchmarkCase) => {
        const recall = benchmarkCase.at[String(maximumCutoff)]?.recall ?? 0;
        return recall < 1;
      })
      .map((benchmarkCase) => ({ strategy, benchmarkCase })),
  );
  lines.push("", `Per-query failures @${maximumCutoff}`);
  if (failures.length === 0) {
    lines.push("  None");
  } else {
    failures
      .sort(compareFailures(maximumCutoff))
      .forEach(({ strategy, benchmarkCase }) => {
        const metrics = benchmarkCase.at[String(maximumCutoff)];
        lines.push(
          `  [${strategy.strategy}] ${benchmarkCase.id}: recall=${formatMetric(metrics?.recall ?? 0)}, firstRelevant=${benchmarkCase.firstRelevantRank ?? "none"}`,
          `    Query: ${benchmarkCase.query}`,
          `    Missing: ${benchmarkCase.missingRelevant.map(formatRelevanceTarget).join("; ")}`,
          `    Top results: ${formatTopResults(benchmarkCase)}`,
        );
      });
  }

  return lines.join("\n");
}

function formatTable(rows: readonly (readonly string[])[]): string {
  const widths = rows.reduce<number[]>((current, row) => {
    row.forEach((cell, index) => {
      current[index] = Math.max(current[index] ?? 0, cell.length);
    });
    return current;
  }, []);
  return rows
    .map((row) =>
      row
        .map((cell, index) => cell.padEnd(widths[index] ?? cell.length))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

function formatMetric(value: number): string {
  return value.toFixed(3);
}

function formatRelevanceTarget(target: RelevanceTarget): string {
  const selectors = [
    ...(target.path ? [`path=${target.path}`] : []),
    ...(target.sourceType ? [`sourceType=${target.sourceType}`] : []),
    ...(target.sourceReference
      ? [`sourceReference=${target.sourceReference}`]
      : []),
  ];
  return `${selectors.join(",")},grade=${target.grade}`;
}

function formatTopResults(benchmarkCase: BenchmarkCaseReport): string {
  const top = benchmarkCase.results.slice(0, 3);
  if (top.length === 0) {
    return "none";
  }
  return top
    .map(
      (result) =>
        `${result.rank}:${result.path ?? result.sourceReference} (${result.sourceType})`,
    )
    .join("; ");
}

function compareFailures(maximumCutoff: number) {
  const key = String(maximumCutoff);
  return (
    left: {
      strategy: StrategyBenchmarkReport;
      benchmarkCase: BenchmarkCaseReport;
    },
    right: {
      strategy: StrategyBenchmarkReport;
      benchmarkCase: BenchmarkCaseReport;
    },
  ): number => {
    const recallDifference =
      (left.benchmarkCase.at[key]?.recall ?? 0) -
      (right.benchmarkCase.at[key]?.recall ?? 0);
    if (recallDifference !== 0) {
      return recallDifference;
    }
    const leftRank =
      left.benchmarkCase.firstRelevantRank ?? Number.POSITIVE_INFINITY;
    const rightRank =
      right.benchmarkCase.firstRelevantRank ?? Number.POSITIVE_INFINITY;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    const strategyDifference = left.strategy.strategy.localeCompare(
      right.strategy.strategy,
    );
    return strategyDifference !== 0
      ? strategyDifference
      : left.benchmarkCase.id.localeCompare(right.benchmarkCase.id);
  };
}
