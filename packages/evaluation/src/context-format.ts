import type {
  AggregateContextStrategyReport,
  ContextBenchmarkReport,
} from "./context-evaluate";

export function formatContextBenchmarkReport(
  report: ContextBenchmarkReport,
): string {
  const lines = [
    report.benchmark,
    `${report.caseCount} ${report.split} cases; ${report.contextBudget} character budget; ${report.primaryAnchors} primary anchors`,
    "",
    "Strategy       Required  Supporting  Complete  Precision  Duplicate  Noise  Files    Chars  Budget  Search  Expand  Total ms",
    formatRow("Raw top-K", report.baseline),
    formatRow("Evidence Pack", report.evidencePack),
    "",
    "Relationship-derived Evidence Pack diagnostics",
    `Labeled precision ${fixed(report.evidencePack.relationshipDerivedEvidencePrecision)} (${report.evidencePack.relationshipDerivedLabeledItems.toFixed(2)}/${report.evidencePack.relationshipDerivedItems.toFixed(2)} mean items per case)`,
    `Exact target rate ${fixed(report.evidencePack.exactRelationshipTargetRate)} (${report.evidencePack.exactSymbolRelationshipItems.toFixed(2)}/${report.evidencePack.symbolBearingRelationshipItems.toFixed(2)} mean symbol-bearing items per case)`,
    `Module-only fallback ${fixed(report.evidencePack.moduleOnlyFallbackRate)} (${report.evidencePack.moduleOnlyRelationshipItems.toFixed(2)} mean items per case)`,
    "",
    "Category changes (Evidence Pack minus raw top-K)",
    ...report.categories.map(
      (category) =>
        `${category.category} (${category.cases}): required ${signed(category.evidencePack.requiredEvidenceRecall - category.baseline.requiredEvidenceRecall)}, complete ${signed(category.evidencePack.completePack - category.baseline.completePack)}, noise ${signed(category.evidencePack.noiseRatio - category.baseline.noiseRatio)}`,
    ),
    "",
    "Incomplete Evidence Packs",
    ...report.cases.flatMap((benchmarkCase) =>
      benchmarkCase.evidencePack.missingRequired.length === 0
        ? []
        : [
            `- ${benchmarkCase.id}: ${benchmarkCase.evidencePack.missingRequired
              .map(
                (target) =>
                  target.path ?? target.sourceReference ?? "unknown target",
              )
              .join(", ")}`,
          ],
    ),
  ];
  return lines.join("\n").trimEnd();
}

function formatRow(
  label: string,
  metrics: AggregateContextStrategyReport,
): string {
  return [
    label.padEnd(14),
    fixed(metrics.requiredEvidenceRecall),
    fixed(metrics.supportingEvidenceRecall),
    fixed(metrics.completePack),
    fixed(metrics.evidencePrecision),
    fixed(metrics.duplicateContentRatio),
    fixed(metrics.noiseRatio),
    metrics.distinctRelevantFiles.toFixed(2).padStart(5),
    Math.round(metrics.payloadCharacters).toString().padStart(7),
    fixed(metrics.budgetUtilization),
    metrics.meanSearchDurationMs.toFixed(1).padStart(7),
    metrics.meanContextExpansionDurationMs.toFixed(1).padStart(7),
    metrics.meanDurationMs.toFixed(1).padStart(8),
  ].join("  ");
}

function fixed(value: number): string {
  return value.toFixed(3).padStart(8);
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}
