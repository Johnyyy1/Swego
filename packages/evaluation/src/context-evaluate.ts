import {
  type EvidenceItem,
  type EvidenceRelationshipProvenance,
  type EvidencePackBuilder,
  type MemorySearchResult,
  type RepositoryMemory,
} from "@swega/retrieval";

import type { RelevanceTarget } from "./schema";
import type { ContextBenchmark, ContextBenchmarkCase } from "./context-schema";

const BASELINE_RETRIEVAL_LIMIT = 50;

interface ObservedEvidence {
  path: string | null;
  sourceType: MemorySearchResult["sourceType"];
  sourceReference: string;
  symbolName: string | null;
  startLine: number | null;
  endLine: number | null;
  content: string;
  relationships: readonly EvidenceRelationshipProvenance[];
}

export interface ContextMetrics {
  requiredEvidenceRecall: number;
  supportingEvidenceRecall: number;
  completePack: number;
  evidencePrecision: number;
  duplicateContentRatio: number;
  budgetUtilization: number;
  distinctRelevantFiles: number;
  noiseRatio: number;
  evidenceItems: number;
  payloadCharacters: number;
  relationshipDerivedItems: number;
  relationshipDerivedLabeledItems: number;
  relationshipDerivedEvidencePrecision: number;
  symbolBearingRelationshipItems: number;
  exactSymbolRelationshipItems: number;
  exactRelationshipTargetRate: number;
  moduleOnlyRelationshipItems: number;
  moduleOnlyFallbackRate: number;
}

export interface ContextCaseStrategyReport {
  strategy: "raw_top_k" | "evidence_pack";
  metrics: ContextMetrics;
  matchedRequired: readonly RelevanceTarget[];
  missingRequired: readonly RelevanceTarget[];
  matchedSupporting: readonly RelevanceTarget[];
  paths: readonly string[];
  searchDurationMs: number;
  contextExpansionDurationMs: number;
  durationMs: number;
}

export interface ContextBenchmarkCaseReport {
  id: string;
  query: string;
  category: ContextBenchmarkCase["category"];
  baseline: ContextCaseStrategyReport;
  evidencePack: ContextCaseStrategyReport;
}

export interface AggregateContextStrategyReport extends ContextMetrics {
  meanSearchDurationMs: number;
  meanContextExpansionDurationMs: number;
  meanDurationMs: number;
}

export interface ContextCategoryReport {
  category: ContextBenchmarkCase["category"];
  cases: number;
  baseline: AggregateContextStrategyReport;
  evidencePack: AggregateContextStrategyReport;
}

export interface ContextBenchmarkReport {
  version: 1;
  benchmark: string;
  description: string;
  split: ContextBenchmark["split"];
  repositoryRevision: string;
  groundTruthMethod: string;
  contextBudget: number;
  primaryAnchors: number;
  caseCount: number;
  baseline: AggregateContextStrategyReport;
  evidencePack: AggregateContextStrategyReport;
  categories: readonly ContextCategoryReport[];
  cases: readonly ContextBenchmarkCaseReport[];
}

export async function evaluateContextBenchmark(
  benchmark: ContextBenchmark,
  memory: RepositoryMemory,
  builder: EvidencePackBuilder,
): Promise<ContextBenchmarkReport> {
  const reports: ContextBenchmarkCaseReport[] = [];
  for (const benchmarkCase of benchmark.cases) {
    const before = benchmarkCase.before
      ? new Date(benchmarkCase.before)
      : undefined;
    const searchInput = {
      repositoryId: benchmarkCase.repositoryId,
      query: benchmarkCase.query,
      limit: BASELINE_RETRIEVAL_LIMIT,
      ...(before ? { before } : {}),
    };
    const baselineStartedAt = performance.now();
    const baselineResults = await memory.searchMemory(searchInput);
    const baselineDurationMs = performance.now() - baselineStartedAt;
    assertRepositoryIsolation(benchmarkCase, baselineResults);
    const baselineEvidence = applyBaselineBudget(
      baselineResults,
      benchmark.contextBudget,
    );

    const packExecution = await builder.buildWithExecution({
      repositoryId: benchmarkCase.repositoryId,
      query: benchmarkCase.query,
      limit: benchmark.primaryAnchors,
      contextBudget: benchmark.contextBudget,
      ...(before ? { before } : {}),
      debug: true,
    });
    const pack = packExecution.pack;
    const packEvidence = pack.evidence.map(toObservedEvidence);
    reports.push({
      id: benchmarkCase.id,
      query: benchmarkCase.query,
      category: benchmarkCase.category,
      baseline: evaluateEvidence(
        "raw_top_k",
        benchmarkCase,
        baselineEvidence,
        benchmark.contextBudget,
        baselineDurationMs,
        baselineDurationMs,
        0,
      ),
      evidencePack: evaluateEvidence(
        "evidence_pack",
        benchmarkCase,
        packEvidence,
        benchmark.contextBudget,
        pack.diagnostics?.timings.totalExcludingRerankerMs ?? 0,
        Math.max(
          0,
          (pack.diagnostics?.timings.searchDurationMs ?? 0) -
            (pack.diagnostics?.timings.rerankingDurationMs ?? 0),
        ),
        pack.diagnostics?.timings.contextExpansionDurationMs ?? 0,
      ),
    });
  }

  const categories = [
    ...new Set(reports.map((report) => report.category)),
  ].sort();
  return {
    version: 1,
    benchmark: benchmark.name,
    description: benchmark.description,
    split: benchmark.split,
    repositoryRevision: benchmark.repositoryRevision,
    groundTruthMethod: benchmark.groundTruthMethod,
    contextBudget: benchmark.contextBudget,
    primaryAnchors: benchmark.primaryAnchors,
    caseCount: reports.length,
    baseline: aggregate(reports.map((report) => report.baseline)),
    evidencePack: aggregate(reports.map((report) => report.evidencePack)),
    categories: categories.map((category) => {
      const categoryReports = reports.filter(
        (report) => report.category === category,
      );
      return {
        category,
        cases: categoryReports.length,
        baseline: aggregate(categoryReports.map((report) => report.baseline)),
        evidencePack: aggregate(
          categoryReports.map((report) => report.evidencePack),
        ),
      };
    }),
    cases: reports,
  };
}

function applyBaselineBudget(
  results: readonly MemorySearchResult[],
  budget: number,
): readonly ObservedEvidence[] {
  const selected: ObservedEvidence[] = [];
  let used = 0;
  for (const result of results) {
    const characters = characterLength(result.content);
    if (characters <= budget - used) {
      selected.push(toObservedSearchResult(result));
      used += characters;
      continue;
    }
    const remaining = budget - used;
    if (remaining > 0) {
      selected.push({
        ...toObservedSearchResult(result),
        content: [...result.content].slice(0, remaining).join(""),
      });
    }
    break;
  }
  return selected;
}

function evaluateEvidence(
  strategy: ContextCaseStrategyReport["strategy"],
  benchmarkCase: ContextBenchmarkCase,
  evidence: readonly ObservedEvidence[],
  budget: number,
  durationMs: number,
  searchDurationMs: number,
  contextExpansionDurationMs: number,
): ContextCaseStrategyReport {
  const matchedRequired = benchmarkCase.required.filter((target) =>
    evidence.some((item) => matchesEvidence(item, target)),
  );
  const matchedSupporting = benchmarkCase.supporting.filter((target) =>
    evidence.some((item) => matchesEvidence(item, target)),
  );
  const missingRequired = benchmarkCase.required.filter(
    (target) => !matchedRequired.includes(target),
  );
  const relevantItems = evidence.filter((item) =>
    [...benchmarkCase.required, ...benchmarkCase.supporting].some((target) =>
      matchesEvidence(item, target),
    ),
  );
  const duplicateItems = countDuplicateEvidence(evidence);
  const payloadCharacters = evidence.reduce(
    (sum, item) => sum + characterLength(item.content),
    0,
  );
  const distinctRelevantFiles = new Set(
    relevantItems.flatMap((item) => (item.path ? [item.path] : [])),
  ).size;
  const evidencePrecision =
    evidence.length === 0 ? 0 : relevantItems.length / evidence.length;
  const relationshipDerived = evidence.filter(
    (item) => item.relationships.length > 0,
  );
  const relationshipDerivedLabeled = relationshipDerived.filter((item) =>
    [...benchmarkCase.required, ...benchmarkCase.supporting].some((target) =>
      matchesEvidence(item, target),
    ),
  );
  const symbolBearing = relationshipDerived.filter((item) =>
    item.relationships.some((relationship) => relationship.importedName),
  );
  const exactSymbol = symbolBearing.filter((item) =>
    item.relationships.some(
      (relationship) =>
        relationship.resolution === "exact_symbol" &&
        relationship.targetSymbol !== null &&
        relationship.targetSymbol === item.symbolName,
    ),
  );
  const moduleOnly = relationshipDerived.filter((item) =>
    item.relationships.every(
      (relationship) => relationship.resolution === "exact_module",
    ),
  );
  return {
    strategy,
    metrics: {
      requiredEvidenceRecall:
        matchedRequired.length / benchmarkCase.required.length,
      supportingEvidenceRecall:
        benchmarkCase.supporting.length === 0
          ? 1
          : matchedSupporting.length / benchmarkCase.supporting.length,
      completePack: Number(
        matchedRequired.length === benchmarkCase.required.length,
      ),
      evidencePrecision,
      duplicateContentRatio:
        evidence.length === 0 ? 0 : duplicateItems / evidence.length,
      budgetUtilization: payloadCharacters / budget,
      distinctRelevantFiles,
      noiseRatio: 1 - evidencePrecision,
      evidenceItems: evidence.length,
      payloadCharacters,
      relationshipDerivedItems: relationshipDerived.length,
      relationshipDerivedLabeledItems: relationshipDerivedLabeled.length,
      relationshipDerivedEvidencePrecision: safeRatio(
        relationshipDerivedLabeled.length,
        relationshipDerived.length,
      ),
      symbolBearingRelationshipItems: symbolBearing.length,
      exactSymbolRelationshipItems: exactSymbol.length,
      exactRelationshipTargetRate: safeRatio(
        exactSymbol.length,
        symbolBearing.length,
      ),
      moduleOnlyRelationshipItems: moduleOnly.length,
      moduleOnlyFallbackRate: safeRatio(
        moduleOnly.length,
        relationshipDerived.length,
      ),
    },
    matchedRequired,
    missingRequired,
    matchedSupporting,
    paths: evidence.flatMap((item) => (item.path ? [item.path] : [])),
    searchDurationMs,
    contextExpansionDurationMs,
    durationMs,
  };
}

function aggregate(
  reports: readonly ContextCaseStrategyReport[],
): AggregateContextStrategyReport {
  const average = (select: (report: ContextCaseStrategyReport) => number) =>
    reports.length === 0
      ? 0
      : reports.reduce((sum, report) => sum + select(report), 0) /
        reports.length;
  const total = (select: (report: ContextCaseStrategyReport) => number) =>
    reports.reduce((sum, report) => sum + select(report), 0);
  const relationshipDerivedItems = total(
    (report) => report.metrics.relationshipDerivedItems,
  );
  const relationshipDerivedLabeledItems = total(
    (report) => report.metrics.relationshipDerivedLabeledItems,
  );
  const symbolBearingRelationshipItems = total(
    (report) => report.metrics.symbolBearingRelationshipItems,
  );
  const exactSymbolRelationshipItems = total(
    (report) => report.metrics.exactSymbolRelationshipItems,
  );
  const moduleOnlyRelationshipItems = total(
    (report) => report.metrics.moduleOnlyRelationshipItems,
  );
  return {
    requiredEvidenceRecall: average(
      (report) => report.metrics.requiredEvidenceRecall,
    ),
    supportingEvidenceRecall: average(
      (report) => report.metrics.supportingEvidenceRecall,
    ),
    completePack: average((report) => report.metrics.completePack),
    evidencePrecision: average((report) => report.metrics.evidencePrecision),
    duplicateContentRatio: average(
      (report) => report.metrics.duplicateContentRatio,
    ),
    budgetUtilization: average((report) => report.metrics.budgetUtilization),
    distinctRelevantFiles: average(
      (report) => report.metrics.distinctRelevantFiles,
    ),
    noiseRatio: average((report) => report.metrics.noiseRatio),
    evidenceItems: average((report) => report.metrics.evidenceItems),
    payloadCharacters: average((report) => report.metrics.payloadCharacters),
    relationshipDerivedItems:
      reports.length === 0 ? 0 : relationshipDerivedItems / reports.length,
    relationshipDerivedLabeledItems:
      reports.length === 0
        ? 0
        : relationshipDerivedLabeledItems / reports.length,
    relationshipDerivedEvidencePrecision: safeRatio(
      relationshipDerivedLabeledItems,
      relationshipDerivedItems,
    ),
    symbolBearingRelationshipItems:
      reports.length === 0
        ? 0
        : symbolBearingRelationshipItems / reports.length,
    exactSymbolRelationshipItems:
      reports.length === 0 ? 0 : exactSymbolRelationshipItems / reports.length,
    exactRelationshipTargetRate: safeRatio(
      exactSymbolRelationshipItems,
      symbolBearingRelationshipItems,
    ),
    moduleOnlyRelationshipItems:
      reports.length === 0 ? 0 : moduleOnlyRelationshipItems / reports.length,
    moduleOnlyFallbackRate: safeRatio(
      moduleOnlyRelationshipItems,
      relationshipDerivedItems,
    ),
    meanSearchDurationMs: average((report) => report.searchDurationMs),
    meanContextExpansionDurationMs: average(
      (report) => report.contextExpansionDurationMs,
    ),
    meanDurationMs: average((report) => report.durationMs),
  };
}

function matchesEvidence(
  evidence: ObservedEvidence,
  target: RelevanceTarget,
): boolean {
  if (target.path !== undefined && evidence.path !== target.path) return false;
  if (
    target.sourceReference !== undefined &&
    evidence.sourceReference !== target.sourceReference
  ) {
    return false;
  }
  if (
    target.sourceType !== undefined &&
    evidence.sourceType !== target.sourceType
  ) {
    return false;
  }
  return (
    target.symbolName === undefined || evidence.symbolName === target.symbolName
  );
}

function countDuplicateEvidence(evidence: readonly ObservedEvidence[]): number {
  const selected: ObservedEvidence[] = [];
  let duplicates = 0;
  for (const item of evidence) {
    if (
      selected.some(
        (candidate) =>
          candidate.content === item.content ||
          (candidate.path === item.path &&
            candidate.symbolName !== null &&
            candidate.symbolName === item.symbolName &&
            candidate.startLine !== null &&
            candidate.endLine !== null &&
            item.startLine !== null &&
            item.endLine !== null &&
            candidate.startLine <= item.endLine &&
            item.startLine <= candidate.endLine),
      )
    ) {
      duplicates += 1;
    } else {
      selected.push(item);
    }
  }
  return duplicates;
}

function toObservedSearchResult(result: MemorySearchResult): ObservedEvidence {
  return {
    path: result.path,
    sourceType: result.sourceType,
    sourceReference: result.sourceMetadata.sourceReference,
    symbolName: result.sourceMetadata.symbolName,
    startLine: result.sourceMetadata.startLine,
    endLine: result.sourceMetadata.endLine,
    content: result.content,
    relationships:
      result.relationshipType && result.relationshipReason
        ? [
            {
              type: result.relationshipType,
              sourcePath: result.relationshipSourcePath ?? null,
              sourceSymbol: result.relationshipSourceSymbol ?? null,
              targetPath: result.relationshipTargetPath ?? result.path,
              targetSymbol: result.relationshipTargetSymbol ?? null,
              importedName: result.relationshipImportedName ?? null,
              localName: result.relationshipLocalName ?? null,
              exposedName: result.relationshipExposedName ?? null,
              bindingKind: result.relationshipBindingKind ?? null,
              isTypeOnly: result.relationshipIsTypeOnly ?? false,
              resolution: result.relationshipResolution ?? null,
              moduleResolutionKind:
                result.relationshipModuleResolutionKind ?? null,
              targetSymbolKind: result.relationshipTargetSymbolKind ?? null,
              targetStartLine: result.relationshipTargetStartLine ?? null,
              targetEndLine: result.relationshipTargetEndLine ?? null,
              configurationPath: result.relationshipConfigurationPath ?? null,
              configurationCommitSha:
                result.relationshipConfigurationCommitSha ?? null,
              depth: 1,
              reason: result.relationshipReason,
            },
          ]
        : [],
  };
}

function toObservedEvidence(item: EvidenceItem): ObservedEvidence {
  return {
    path: item.source.path,
    sourceType: item.source.sourceType,
    sourceReference: item.source.sourceReference,
    symbolName: item.source.symbolName,
    startLine: item.source.startLine,
    endLine: item.source.endLine,
    content: item.content,
    relationships: item.relationships,
  };
}

function assertRepositoryIsolation(
  benchmarkCase: ContextBenchmarkCase,
  results: readonly MemorySearchResult[],
): void {
  const mismatched = results.find(
    (result) => result.repositoryId !== benchmarkCase.repositoryId,
  );
  if (mismatched) {
    throw new Error(
      `Context baseline returned repository '${mismatched.repositoryId}' for case '${benchmarkCase.id}', expected '${benchmarkCase.repositoryId}'`,
    );
  }
}

function characterLength(value: string): number {
  return [...value].length;
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
