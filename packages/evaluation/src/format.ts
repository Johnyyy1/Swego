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

  const candidateRows = report.strategies.flatMap((strategy) => {
    const diagnostics = strategy.aggregate.candidateDiagnostics;
    return diagnostics
      ? [
          [
            strategy.strategy,
            formatMetric(diagnostics.candidateRecall),
            formatMetric(diagnostics.meanCandidateCount),
            formatBytes(diagnostics.meanCandidateBytes),
            formatMilliseconds(diagnostics.meanCandidateGenerationDurationMs),
            formatMilliseconds(diagnostics.meanRerankingDurationMs),
            formatMetric(diagnostics.meanRelationshipOnlyCandidateCount),
            String(diagnostics.targetsRecoveredOnlyByRelationshipCount),
            String(diagnostics.relationshipFalsePositiveCandidateCount),
          ],
        ]
      : [];
  });
  if (candidateRows.length > 0) {
    lines.push(
      "",
      "Candidate and reranking diagnostics",
      formatTable([
        [
          "Strategy",
          "Candidate Recall",
          "Candidates",
          "Candidate Bytes",
          "Generation",
          "Reranking",
          "Rel-only",
          "Targets recovered",
          "Rel false positives",
        ],
        ...candidateRows,
      ]),
    );
    lines.push(
      "",
      "Candidate failure classes (targets)",
      formatTable([
        [
          "Strategy",
          "A: absent",
          "B: wrong chunk",
          "C: reranked",
          "D: returned",
        ],
        ...report.strategies.flatMap((strategy) => {
          const counts =
            strategy.aggregate.candidateDiagnostics?.targetOutcomeCounts;
          return counts
            ? [
                [
                  strategy.strategy,
                  String(counts.absent_from_candidate_pool),
                  String(counts.wrong_chunk_from_target_file),
                  String(counts.reranked_below_cutoff),
                  String(counts.successfully_returned),
                ],
              ]
            : [];
        }),
      ]),
    );
  }

  const meaningfulCategoryRows = report.strategies.flatMap((strategy) =>
    strategy.categories
      .filter((category) => category.cases >= 3)
      .map((category) => [
        strategy.strategy,
        category.category,
        String(category.cases),
        formatMetric(category.mrr),
        formatMetric(category.at["10"]?.recall ?? 0),
        formatMetric(category.at["10"]?.ndcg ?? 0),
      ]),
  );
  if (meaningfulCategoryRows.length > 0) {
    lines.push(
      "",
      "Metrics by category (categories with at least 3 cases)",
      formatTable([
        ["Strategy", "Category", "Cases", "MRR", "Recall@10", "nDCG@10"],
        ...meaningfulCategoryRows,
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
          ...(benchmarkCase.candidateDiagnostics
            ? [
                `    Cause: ${
                  benchmarkCase.candidateDiagnostics.missingRelevant
                    .map(
                      (item) =>
                        `${formatRelevanceTarget(item.target)}=${item.reason}${item.candidateRank === null ? "" : ` (candidate rank ${item.candidateRank})`}`,
                    )
                    .join("; ") || "none"
                }`,
              ]
            : []),
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

function formatBytes(value: number): string {
  return `${Math.round(value / 1024)} KiB`;
}

function formatMilliseconds(value: number): string {
  return `${value.toFixed(1)} ms`;
}

function formatRelevanceTarget(target: RelevanceTarget): string {
  const selectors = [
    ...(target.path ? [`path=${target.path}`] : []),
    ...(target.sourceType ? [`sourceType=${target.sourceType}`] : []),
    ...(target.sourceReference
      ? [`sourceReference=${target.sourceReference}`]
      : []),
    ...(target.symbolName ? [`symbolName=${target.symbolName}`] : []),
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
