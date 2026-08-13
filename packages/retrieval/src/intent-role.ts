import { DEFAULT_RRF_K } from "./rrf";
import { classifySourceRole, type SourceRole } from "./source-role";
import type { QueryIntent, QueryIntentSignal } from "./query-intent";
import type { MemorySearchResult } from "./types";

export const intentRolePriorStrategies = ["none", "weak", "moderate"] as const;
export type IntentRolePriorStrategy =
  (typeof intentRolePriorStrategies)[number];

export const DEFAULT_INTENT_ROLE_PRIOR_STRATEGY =
  "weak" satisfies IntentRolePriorStrategy;
export const INTENT_ROLE_PRIOR_WEIGHTS: Readonly<
  Record<IntentRolePriorStrategy, number>
> = Object.freeze({ none: 0, weak: 0.2, moderate: 0.5 });
export const MIN_INTENT_ROLE_BRANCH_COMPATIBILITY = 0.75;

export interface IntentRolePriorOptions {
  strategy?: IntentRolePriorStrategy;
  rrfK?: number;
}

interface Compatibility {
  score: number;
  reason: string | null;
}

const compatibility: Readonly<
  Partial<Record<QueryIntent, Partial<Record<SourceRole, number>>>>
> = {
  implementation: {
    production_implementation: 1,
    type_definition: 0.45,
    api_definition: 0.5,
    database_schema: 0.45,
    configuration: 0.4,
    script: 0.35,
    migration: 0.2,
    unit_test: 0.12,
    integration_test: 0.12,
    e2e_test: 0.12,
    fixture: 0.05,
    documentation: 0.15,
  },
  tests: {
    unit_test: 1,
    integration_test: 1,
    e2e_test: 1,
    fixture: 0.6,
    production_implementation: 0.25,
    configuration: 0.2,
  },
  configuration: {
    configuration: 1,
    production_implementation: 0.35,
    documentation: 0.35,
    script: 0.3,
  },
  documentation: {
    documentation: 1,
    generated_reference_documentation: 0.8,
    api_definition: 0.45,
    development_history: 0.3,
  },
  database_schema: {
    database_schema: 1,
    migration: 0.6,
    type_definition: 0.45,
    production_implementation: 0.35,
  },
  migration: {
    migration: 1,
    database_schema: 0.55,
    development_history: 0.3,
  },
  api_endpoint: {
    api_definition: 0.8,
    production_implementation: 1,
    type_definition: 0.3,
    documentation: 0.25,
    unit_test: 0.15,
    integration_test: 0.15,
    e2e_test: 0.15,
  },
  error_handling: {
    production_implementation: 0.8,
    unit_test: 0.45,
    integration_test: 0.45,
    e2e_test: 0.45,
    documentation: 0.15,
  },
  authentication: {
    production_implementation: 0.55,
    configuration: 0.35,
    database_schema: 0.25,
    unit_test: 0.2,
    integration_test: 0.2,
    e2e_test: 0.2,
  },
  authorization: {
    production_implementation: 0.55,
    configuration: 0.35,
    database_schema: 0.25,
    unit_test: 0.2,
    integration_test: 0.2,
    e2e_test: 0.2,
  },
  history_rationale: {
    development_history: 1,
    migration: 0.4,
    documentation: 0.3,
  },
};

export function applyIntentRolePrior(
  candidates: readonly MemorySearchResult[],
  querySignals: readonly QueryIntentSignal[],
  options: IntentRolePriorOptions = {},
): readonly MemorySearchResult[] {
  const strategy = options.strategy ?? DEFAULT_INTENT_ROLE_PRIOR_STRATEGY;
  const weight = INTENT_ROLE_PRIOR_WEIGHTS[strategy];
  const k = options.rrfK ?? DEFAULT_RRF_K;
  if (!Number.isFinite(k) || k < 0) {
    throw new Error("Intent-role RRF k must be a non-negative finite number");
  }

  const classified = candidates.map((candidate, index) => {
    const sourceRole = classifySourceRole(candidate);
    const roleCompatibility = compatibilityFor(
      candidate,
      sourceRole.role,
      querySignals,
    );
    return {
      candidate,
      originalRank: candidate.rrfRank ?? index + 1,
      sourceRole,
      ...roleCompatibility,
    };
  });
  const roleRanks = new Map(
    classified
      .filter((item) => item.score >= MIN_INTENT_ROLE_BRANCH_COMPATIBILITY)
      .sort(
        (left, right) =>
          left.originalRank - right.originalRank ||
          left.candidate.sourceMetadata.chunkId.localeCompare(
            right.candidate.sourceMetadata.chunkId,
          ),
      )
      .map((item, index) => [item.candidate.sourceMetadata.chunkId, index + 1]),
  );

  return classified
    .map((item) => {
      const intentRoleRank = roleRanks.get(
        item.candidate.sourceMetadata.chunkId,
      );
      const intentRoleScore =
        intentRoleRank === undefined ? 0 : weight / (k + intentRoleRank);
      return {
        ...item.candidate,
        queryIntents: querySignals,
        sourceRole: item.sourceRole.role,
        sourceRoleConfidence: item.sourceRole.confidence,
        sourceRoleEvidence: item.sourceRole.evidence,
        roleCompatibility: item.score,
        ...(item.reason ? { roleCompatibilityReason: item.reason } : {}),
        ...(intentRoleRank === undefined ? {} : { intentRoleRank }),
        intentRoleScore,
        rrfRankBeforeIntentRole: item.originalRank,
        rrfScore: (item.candidate.rrfScore ?? 0) + intentRoleScore,
      } satisfies MemorySearchResult;
    })
    .sort(
      (left, right) =>
        (right.rrfScore ?? 0) - (left.rrfScore ?? 0) ||
        (left.rrfRankBeforeIntentRole ?? 0) -
          (right.rrfRankBeforeIntentRole ?? 0) ||
        left.sourceMetadata.chunkId.localeCompare(right.sourceMetadata.chunkId),
    )
    .map((candidate, index) => ({ ...candidate, rrfRank: index + 1 }));
}

function compatibilityFor(
  candidate: MemorySearchResult,
  role: SourceRole,
  querySignals: readonly QueryIntentSignal[],
): Compatibility {
  let best: { score: number; signal: QueryIntentSignal } | null = null;
  for (const signal of querySignals) {
    let roleWeight = compatibility[signal.intent]?.[role] ?? 0;
    if (signal.intent === "exact_symbol") {
      roleWeight = candidate.structuredExactMatch
        ? 1
        : candidate.sourceMetadata.symbolName
          ? 0.55
          : 0;
    }
    const score = roleWeight * signal.confidence;
    if (score > (best?.score ?? 0)) best = { score, signal };
  }
  if (!best) return { score: 0, reason: null };
  const reason =
    best.signal.intent === "exact_symbol"
      ? candidate.structuredExactMatch
        ? "exact-symbol intent matches exact structural metadata"
        : `exact-symbol intent prefers symbol-bearing ${role} evidence`
      : `${best.signal.intent} intent prefers ${role} evidence`;
  return { score: best.score, reason };
}
