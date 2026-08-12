import type { MemorySearchResult, RepositoryMemory } from "@swega/retrieval";

import { evaluateRanking, type CutoffMetrics } from "./metrics";
import type {
  RelevanceTarget,
  RetrievalBenchmark,
  RetrievalBenchmarkCase,
} from "./schema";

export interface RetrievalStrategy {
  name: string;
  memory: RepositoryMemory;
}

export interface ObservedSearchResult {
  rank: number;
  path: string | null;
  sourceType: MemorySearchResult["sourceType"];
  sourceReference: string;
  symbolName: string | null;
  symbolKind: MemorySearchResult["sourceMetadata"]["symbolKind"];
}

export interface BenchmarkCaseReport {
  id: string;
  query: string;
  repositoryId: string;
  before?: string;
  tags?: readonly string[];
  reciprocalRank: number;
  firstRelevantRank: number | null;
  at: Readonly<Record<string, CutoffMetrics>>;
  matchedRelevant: readonly RelevanceTarget[];
  missingRelevant: readonly RelevanceTarget[];
  results: readonly ObservedSearchResult[];
}

export interface AggregateStrategyMetrics {
  cases: number;
  mrr: number;
  at: Readonly<Record<string, CutoffMetrics>>;
}

export interface StrategyBenchmarkReport {
  strategy: string;
  aggregate: AggregateStrategyMetrics;
  cases: readonly BenchmarkCaseReport[];
}

export interface RetrievalBenchmarkReport {
  version: 1;
  benchmark: string;
  description?: string;
  caseCount: number;
  cutoffs: readonly number[];
  strategies: readonly StrategyBenchmarkReport[];
}

export class EvaluationRepositoryMismatchError extends Error {
  override readonly name = "EvaluationRepositoryMismatchError";

  constructor(
    strategy: string,
    benchmarkCase: RetrievalBenchmarkCase,
    actualRepositoryId: string,
  ) {
    super(
      `Retrieval strategy '${strategy}' returned repository '${actualRepositoryId}' for benchmark case '${benchmarkCase.id}', expected '${benchmarkCase.repositoryId}'`,
    );
  }
}

export async function evaluateRetrievalBenchmark(
  benchmark: RetrievalBenchmark,
  strategies: readonly RetrievalStrategy[],
): Promise<RetrievalBenchmarkReport> {
  validateStrategies(strategies);
  const maximumCutoff = Math.max(...benchmark.cutoffs);
  const strategyReports: StrategyBenchmarkReport[] = [];

  for (const strategy of strategies) {
    const caseReports: BenchmarkCaseReport[] = [];
    for (const benchmarkCase of benchmark.cases) {
      const results = await strategy.memory.searchMemory({
        repositoryId: benchmarkCase.repositoryId,
        query: benchmarkCase.query,
        limit: maximumCutoff,
        ...(benchmarkCase.before
          ? { before: new Date(benchmarkCase.before) }
          : {}),
      });
      const mismatched = results.find(
        (result) => result.repositoryId !== benchmarkCase.repositoryId,
      );
      if (mismatched) {
        throw new EvaluationRepositoryMismatchError(
          strategy.name,
          benchmarkCase,
          mismatched.repositoryId,
        );
      }

      caseReports.push(
        evaluateBenchmarkCase(benchmarkCase, results, benchmark.cutoffs),
      );
    }
    strategyReports.push({
      strategy: strategy.name,
      aggregate: aggregateCaseReports(caseReports, benchmark.cutoffs),
      cases: caseReports,
    });
  }

  return {
    version: 1,
    benchmark: benchmark.name,
    ...(benchmark.description ? { description: benchmark.description } : {}),
    caseCount: benchmark.cases.length,
    cutoffs: benchmark.cutoffs,
    strategies: strategyReports,
  };
}

function evaluateBenchmarkCase(
  benchmarkCase: RetrievalBenchmarkCase,
  results: readonly MemorySearchResult[],
  cutoffs: readonly number[],
): BenchmarkCaseReport {
  const evaluation = evaluateRanking(results, benchmarkCase.relevant, cutoffs);
  const matchedRelevant = benchmarkCase.relevant.filter(
    (_, index) => evaluation.targetRanks[index] !== null,
  );
  const missingRelevant = benchmarkCase.relevant.filter(
    (_, index) => evaluation.targetRanks[index] === null,
  );
  const maximumCutoff = Math.max(...cutoffs);

  return {
    id: benchmarkCase.id,
    query: benchmarkCase.query,
    repositoryId: benchmarkCase.repositoryId,
    ...(benchmarkCase.before ? { before: benchmarkCase.before } : {}),
    ...(benchmarkCase.tags ? { tags: benchmarkCase.tags } : {}),
    reciprocalRank: evaluation.reciprocalRank,
    firstRelevantRank: evaluation.firstRelevantRank,
    at: evaluation.at,
    matchedRelevant,
    missingRelevant,
    results: results.slice(0, maximumCutoff).map((result, index) => ({
      rank: index + 1,
      path: result.path,
      sourceType: result.sourceType,
      sourceReference: result.sourceMetadata.sourceReference,
      symbolName: result.sourceMetadata.symbolName,
      symbolKind: result.sourceMetadata.symbolKind,
    })),
  };
}

function aggregateCaseReports(
  cases: readonly BenchmarkCaseReport[],
  cutoffs: readonly number[],
): AggregateStrategyMetrics {
  const at: Record<string, CutoffMetrics> = {};
  for (const cutoff of cutoffs) {
    const key = String(cutoff);
    at[key] = {
      precision: mean(cases.map((report) => report.at[key]?.precision ?? 0)),
      recall: mean(cases.map((report) => report.at[key]?.recall ?? 0)),
      hitRate: mean(cases.map((report) => report.at[key]?.hitRate ?? 0)),
      ndcg: mean(cases.map((report) => report.at[key]?.ndcg ?? 0)),
    };
  }
  return {
    cases: cases.length,
    mrr: mean(cases.map((report) => report.reciprocalRank)),
    at,
  };
}

function validateStrategies(strategies: readonly RetrievalStrategy[]): void {
  if (strategies.length === 0) {
    throw new Error("Retrieval benchmark requires at least one strategy");
  }
  const names = new Set<string>();
  for (const strategy of strategies) {
    if (!strategy.name.trim()) {
      throw new Error("Retrieval strategy name must not be empty");
    }
    if (names.has(strategy.name)) {
      throw new Error(`Duplicate retrieval strategy '${strategy.name}'`);
    }
    names.add(strategy.name);
  }
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}
