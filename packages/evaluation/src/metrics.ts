import type { MemorySearchResult } from "@swega/retrieval";

import type { RelevanceTarget } from "./schema";

export interface CutoffMetrics {
  precision: number;
  recall: number;
  hitRate: number;
  ndcg: number;
}

export interface RankingEvaluation {
  reciprocalRank: number;
  firstRelevantRank: number | null;
  at: Readonly<Record<string, CutoffMetrics>>;
  targetRanks: readonly (number | null)[];
  relevanceGradesByRank: readonly number[];
}

export function evaluateRanking(
  results: readonly MemorySearchResult[],
  relevant: readonly RelevanceTarget[],
  cutoffs: readonly number[],
): RankingEvaluation {
  if (relevant.length === 0) {
    throw new Error(
      "Ranking evaluation requires at least one relevance target",
    );
  }
  if (cutoffs.length === 0) {
    throw new Error("Ranking evaluation requires at least one cutoff");
  }
  if (
    cutoffs.some((cutoff) => !Number.isInteger(cutoff) || cutoff < 1) ||
    new Set(cutoffs).size !== cutoffs.length
  ) {
    throw new Error(
      "Ranking evaluation cutoffs must be unique positive integers",
    );
  }

  const maximumCutoff = Math.max(...cutoffs);
  const targetRanks: Array<number | null> = relevant.map(() => null);
  const relevanceGradesByRank = Array.from(
    { length: Math.min(results.length, maximumCutoff) },
    () => 0,
  );

  results.slice(0, maximumCutoff).forEach((result, resultIndex) => {
    const targetIndex = selectUnmatchedTarget(result, relevant, targetRanks);
    if (targetIndex === null) {
      return;
    }
    const rank = resultIndex + 1;
    targetRanks[targetIndex] = rank;
    relevanceGradesByRank[resultIndex] = relevant[targetIndex]?.grade ?? 0;
  });

  const firstRelevantRank = targetRanks.reduce<number | null>(
    (first, rank) =>
      rank !== null && (first === null || rank < first) ? rank : first,
    null,
  );
  const at: Record<string, CutoffMetrics> = {};
  for (const cutoff of cutoffs) {
    const relevantResults = relevanceGradesByRank
      .slice(0, cutoff)
      .filter((grade) => grade > 0).length;
    const recalledTargets = targetRanks.filter(
      (rank) => rank !== null && rank <= cutoff,
    ).length;
    at[String(cutoff)] = {
      precision: relevantResults / cutoff,
      recall: recalledTargets / relevant.length,
      hitRate: relevantResults > 0 ? 1 : 0,
      ndcg: normalizedDiscountedCumulativeGain(
        relevanceGradesByRank,
        relevant.map((target) => target.grade),
        cutoff,
      ),
    };
  }

  return {
    reciprocalRank: firstRelevantRank === null ? 0 : 1 / firstRelevantRank,
    firstRelevantRank,
    at,
    targetRanks,
    relevanceGradesByRank,
  };
}

export function matchesRelevanceTarget(
  result: MemorySearchResult,
  target: RelevanceTarget,
): boolean {
  return (
    (target.path === undefined || result.path === target.path) &&
    (target.sourceType === undefined ||
      result.sourceType === target.sourceType) &&
    (target.sourceReference === undefined ||
      result.sourceMetadata.sourceReference === target.sourceReference)
  );
}

function selectUnmatchedTarget(
  result: MemorySearchResult,
  relevant: readonly RelevanceTarget[],
  targetRanks: readonly (number | null)[],
): number | null {
  let selected: number | null = null;
  relevant.forEach((target, index) => {
    if (
      targetRanks[index] !== null ||
      !matchesRelevanceTarget(result, target)
    ) {
      return;
    }
    const selectedGrade =
      selected === null ? -1 : (relevant[selected]?.grade ?? -1);
    if (target.grade > selectedGrade) {
      selected = index;
    }
  });
  return selected;
}

function normalizedDiscountedCumulativeGain(
  relevanceGradesByRank: readonly number[],
  idealGrades: readonly number[],
  cutoff: number,
): number {
  const dcg = discountedCumulativeGain(relevanceGradesByRank.slice(0, cutoff));
  const idealDcg = discountedCumulativeGain(
    [...idealGrades].sort((left, right) => right - left).slice(0, cutoff),
  );
  return idealDcg === 0 ? 0 : dcg / idealDcg;
}

function discountedCumulativeGain(grades: readonly number[]): number {
  return grades.reduce(
    (total, grade, index) =>
      total + (Math.pow(2, grade) - 1) / Math.log2(index + 2),
    0,
  );
}
