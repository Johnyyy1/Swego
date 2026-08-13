import type {
  EvidenceItem,
  EvidencePack,
  EvidencePackDecision,
} from "./context-types";

export function formatEvidencePack(pack: EvidencePack): string {
  const lines = [
    `Evidence Pack v${pack.schemaVersion}`,
    `Repository: ${pack.repository.owner}/${pack.repository.name} (${pack.repository.id})`,
    `Query: ${pack.query}`,
    `Cutoff: ${pack.cutoff.toISOString()}`,
    `Intents: ${pack.intents.map((intent) => `${intent.intent} (${intent.confidence.toFixed(2)})`).join(", ")}`,
    `Budget: ${pack.budget.usedCharacters}/${pack.budget.maximumCharacters} characters (~${pack.budget.estimatedTokens} tokens)`,
    "",
  ];
  if (pack.evidence.length === 0) {
    lines.push("No evidence was found.");
  } else {
    for (const item of pack.evidence) {
      lines.push(...formatEvidenceItem(item), "");
    }
  }
  if (pack.diagnostics) {
    lines.push(
      "Debug decisions",
      ...pack.diagnostics.decisions.map(formatDecision),
      "",
      `Timings: search ${pack.diagnostics.timings.searchDurationMs.toFixed(1)} ms; expansion ${pack.diagnostics.timings.contextExpansionDurationMs.toFixed(1)} ms; total excluding reranker ${pack.diagnostics.timings.totalExcludingRerankerMs.toFixed(1)} ms; total ${pack.diagnostics.timings.totalDurationMs.toFixed(1)} ms`,
    );
  }
  return lines.join("\n").trimEnd();
}

export function formatEvidencePackJson(pack: EvidencePack): string {
  return JSON.stringify(pack, null, 2);
}

function formatEvidenceItem(item: EvidenceItem): string[] {
  const source = item.source;
  const location = source.path ?? source.sourceReference;
  const lineRange =
    source.startLine === null
      ? ""
      : source.endLine === null
        ? `:${source.startLine}`
        : `:${source.startLine}-${source.endLine}`;
  const symbol = source.symbolName
    ? ` | ${source.symbolKind ?? "symbol"} ${source.symbolName}`
    : "";
  const retrieval = item.retrieval
    ? ` | retrieval rank ${item.retrieval.rank}`
    : "";
  return [
    `[${item.order}] ${item.contextRole} — ${location}${lineRange}${symbol}`,
    `Source role: ${source.sourceRole}${retrieval}`,
    `Reason: ${item.reasons.map((reason) => reason.kind).join(", ")}`,
    ...(item.relationships.length > 0
      ? [
          `Relationship: ${item.relationships
            .map(
              (relationship) =>
                `${relationship.type} (${relationship.sourcePath ?? "unknown"} -> ${relationship.targetPath ?? "unknown"})`,
            )
            .join(", ")}`,
        ]
      : []),
    `Content (${item.contentCharacters} characters${item.truncated ? ", truncated" : ""}):`,
    item.content,
  ];
}

function formatDecision(decision: EvidencePackDecision): string {
  const location = decision.path ?? "pathless source";
  const symbol = decision.symbolName ? `#${decision.symbolName}` : "";
  const priority =
    decision.budgetPriority === null
      ? ""
      : ` priority=${decision.budgetPriority}`;
  return `- ${decision.action} ${location}${symbol}${priority} used=${decision.cumulativeCharacters}: ${decision.reason}`;
}
