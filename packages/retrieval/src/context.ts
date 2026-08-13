import { analyzeQueryIntent, type QueryIntentSignal } from "./query-intent";
import { classifySourceRole, type SourceRole } from "./source-role";
import { supportsSearchMemoryDiagnostics } from "./types";
import type {
  BuildEvidencePackInput,
  ContextEvidenceSource,
  EvidenceContextRole,
  EvidenceItem,
  EvidencePack,
  EvidencePackDecision,
  EvidencePackExecution,
  EvidenceReason,
  EvidenceReasonKind,
  EvidenceRelationshipProvenance,
  EvidenceRetrievalProvenance,
  LocalContextCandidate,
} from "./context-types";
import type { MemorySearchResult, RepositoryMemory } from "./types";
import type { RelationshipExpansion } from "./relationship-expansion";

export const DEFAULT_CONTEXT_BUDGET = 30_000;
export const DEFAULT_CONTEXT_PRIMARY_ANCHORS = 5;
export const DEFAULT_CONTEXT_SUPPORTING_PER_ANCHOR = 2;
export const MAX_CONTEXT_PRIMARY_ANCHORS = 5;
export const EVIDENCE_PACK_SCHEMA_VERSION = 1;

const MIN_CONTEXT_BUDGET = 256;
const SEARCH_OVERFETCH_FACTOR = 3;
const MIN_SEARCH_RESULT_COUNT = 10;

interface EvidenceCandidate {
  result: MemorySearchResult;
  contextRole: EvidenceContextRole;
  reasons: EvidenceReason[];
  retrieval: EvidenceRetrievalProvenance | null;
  relationships: EvidenceRelationshipProvenance[];
  priority: number;
  sequence: number;
}

interface BudgetResult {
  evidence: EvidenceItem[];
  usedCharacters: number;
  truncatedItems: number;
  rejectedItems: number;
}

export interface EvidencePackBuilderOptions {
  supportingItemsPerAnchor?: number;
}

export class EvidencePackBuilder {
  private readonly supportingItemsPerAnchor: number;

  constructor(
    private readonly memory: RepositoryMemory,
    private readonly evidenceSource: ContextEvidenceSource,
    private readonly relationships?: RelationshipExpansion,
    options: EvidencePackBuilderOptions = {},
  ) {
    this.supportingItemsPerAnchor = validatePositiveInteger(
      options.supportingItemsPerAnchor ?? DEFAULT_CONTEXT_SUPPORTING_PER_ANCHOR,
      "Supporting item limit",
    );
  }

  async build(input: BuildEvidencePackInput): Promise<EvidencePack> {
    return (await this.buildWithExecution(input)).pack;
  }

  async buildWithExecution(
    input: BuildEvidencePackInput,
  ): Promise<EvidencePackExecution> {
    const query = input.query.trim();
    if (!query) throw new Error("Context query must not be empty");
    const anchorLimit = validateAnchorLimit(
      input.limit ?? DEFAULT_CONTEXT_PRIMARY_ANCHORS,
    );
    const maximumCharacters = validateContextBudget(
      input.contextBudget ?? DEFAULT_CONTEXT_BUDGET,
    );
    const cutoff = input.before ?? new Date();
    if (Number.isNaN(cutoff.getTime())) {
      throw new Error("Context cutoff must be a valid date");
    }
    const intents = analyzeQueryIntent(query);
    const decisions: EvidencePackDecision[] = [];
    const totalStartedAt = performance.now();
    const searchStartedAt = performance.now();
    const searchInput = {
      repositoryId: input.repositoryId,
      query,
      limit: Math.max(
        MIN_SEARCH_RESULT_COUNT,
        anchorLimit * SEARCH_OVERFETCH_FACTOR,
      ),
      before: cutoff,
    };
    const repositoryPromise = this.evidenceSource.loadRepository(
      input.repositoryId,
    );
    const execution = supportsSearchMemoryDiagnostics(this.memory)
      ? await this.memory.searchMemoryWithDiagnostics(searchInput)
      : null;
    const retrievalResults = execution
      ? execution.results
      : await this.memory.searchMemory(searchInput);
    const searchDurationMs = performance.now() - searchStartedAt;
    assertSafeResults(retrievalResults, input.repositoryId, cutoff);
    const anchors = selectEvidenceAnchors(
      retrievalResults,
      intents,
      anchorLimit,
      decisions,
    );

    const expansionStartedAt = performance.now();
    const expandsCurrentSource = !hasIntent(intents, "history_rationale");
    const [repository, local, related] = await Promise.all([
      repositoryPromise,
      expandsCurrentSource
        ? this.evidenceSource.loadLocalContext({
            repositoryId: input.repositoryId,
            before: cutoff,
            anchors,
          })
        : Promise.resolve([]),
      expandsCurrentSource && this.relationships
        ? this.relationships.expand({
            repositoryId: input.repositoryId,
            query,
            before: cutoff,
            anchors,
            maxNeighborsPerAnchor: this.supportingItemsPerAnchor,
            candidateLimit: anchors.length * this.supportingItemsPerAnchor,
          })
        : Promise.resolve([]),
    ]);
    assertSafeResults(
      local.map((candidate) => candidate.result),
      input.repositoryId,
      cutoff,
    );
    assertSafeResults(related, input.repositoryId, cutoff);

    const candidates = buildCandidates(
      anchors,
      local,
      related,
      retrievalResults,
      intents,
    );
    const deduplicated = deduplicateCandidates(candidates, decisions);
    const budgeted = applyEvidenceBudget(
      deduplicated,
      maximumCharacters,
      decisions,
    );
    const contextExpansionDurationMs = performance.now() - expansionStartedAt;
    const totalDurationMs = performance.now() - totalStartedAt;
    const rerankingDurationMs = execution?.diagnostics.rerankingDurationMs ?? 0;
    const revisions = [
      ...new Set(
        budgeted.evidence.flatMap((item) =>
          item.source.commitSha ? [item.source.commitSha] : [],
        ),
      ),
    ].sort();

    return {
      pack: {
        schemaVersion: EVIDENCE_PACK_SCHEMA_VERSION,
        repository,
        query,
        cutoff,
        revisions,
        intents,
        evidence: budgeted.evidence,
        budget: {
          maximumCharacters,
          usedCharacters: budgeted.usedCharacters,
          remainingCharacters: maximumCharacters - budgeted.usedCharacters,
          estimatedTokens: Math.ceil(budgeted.usedCharacters / 4),
          truncatedItems: budgeted.truncatedItems,
          rejectedItems: budgeted.rejectedItems,
        },
        ...(input.debug
          ? {
              diagnostics: {
                decisions,
                timings: {
                  searchDurationMs,
                  contextExpansionDurationMs,
                  totalDurationMs,
                  rerankingDurationMs,
                  totalExcludingRerankerMs: Math.max(
                    0,
                    totalDurationMs - rerankingDurationMs,
                  ),
                },
              },
            }
          : {}),
      },
      retrievalResults,
    };
  }
}

export function selectEvidenceAnchors(
  results: readonly MemorySearchResult[],
  intents: readonly QueryIntentSignal[],
  limit = DEFAULT_CONTEXT_PRIMARY_ANCHORS,
  decisions: EvidencePackDecision[] = [],
): readonly MemorySearchResult[] {
  validateAnchorLimit(limit);
  const ranked = results.map((result, index) => ({ result, rank: index + 1 }));
  ranked.sort(
    (left, right) =>
      Number(right.result.structuredExactMatch === true) -
        Number(left.result.structuredExactMatch === true) ||
      anchorIntentPriority(left.result, intents) -
        anchorIntentPriority(right.result, intents) ||
      left.rank - right.rank ||
      left.result.sourceMetadata.chunkId.localeCompare(
        right.result.sourceMetadata.chunkId,
      ),
  );
  const selected: MemorySearchResult[] = [];
  const seenPaths = new Set<string>();
  const seenSymbols = new Set<string>();
  const seenContent = new Set<string>();
  for (const candidate of ranked) {
    const result = candidate.result;
    const path = result.path;
    const symbolKey = structuralKey(result);
    const duplicateReason = seenContent.has(result.content)
      ? "identical content already selected"
      : symbolKey && seenSymbols.has(symbolKey)
        ? "same structural symbol already selected"
        : path && seenPaths.has(path)
          ? "path already represented by a stronger anchor"
          : null;
    if (duplicateReason) {
      decisions.push(
        decision("anchor_rejected", result, null, duplicateReason, null, 0),
      );
      continue;
    }
    selected.push(result);
    seenContent.add(result.content);
    if (path) seenPaths.add(path);
    if (symbolKey) seenSymbols.add(symbolKey);
    decisions.push(
      decision(
        "anchor_selected",
        result,
        primaryContextRole(
          result.sourceRole ?? classifySourceRole(result).role,
        ),
        `retrieval rank ${candidate.rank}${result.structuredExactMatch ? "; exact symbol match" : ""}`,
        0,
        0,
      ),
    );
    if (selected.length >= limit) break;
  }
  return selected;
}

function anchorIntentPriority(
  result: MemorySearchResult,
  intents: readonly QueryIntentSignal[],
): number {
  const role = result.sourceRole ?? classifySourceRole(result).role;
  if (hasIntent(intents, "tests")) {
    return isTestRole(role) ? 0 : role === "production_implementation" ? 1 : 2;
  }
  if (hasIntent(intents, "configuration")) {
    return role === "configuration"
      ? 0
      : role === "production_implementation"
        ? 1
        : 2;
  }
  if (hasIntent(intents, "database_schema")) {
    return role === "database_schema"
      ? 0
      : role === "migration"
        ? 1
        : role === "production_implementation"
          ? 2
          : 3;
  }
  if (hasIntent(intents, "migration")) {
    return role === "migration"
      ? 0
      : role === "database_schema"
        ? 1
        : role === "production_implementation"
          ? 2
          : 3;
  }
  if (hasIntent(intents, "api_endpoint")) {
    return role === "production_implementation"
      ? 0
      : role === "api_definition"
        ? 1
        : role === "documentation" ||
            role === "generated_reference_documentation"
          ? 2
          : 3;
  }
  if (hasIntent(intents, "history_rationale")) {
    return role === "development_history" ? 0 : 1;
  }
  if (hasIntent(intents, "implementation")) {
    return role === "production_implementation"
      ? 0
      : role === "type_definition"
        ? 1
        : isTestRole(role)
          ? 2
          : 3;
  }
  return 0;
}

function buildCandidates(
  anchors: readonly MemorySearchResult[],
  local: readonly LocalContextCandidate[],
  related: readonly MemorySearchResult[],
  retrievalResults: readonly MemorySearchResult[],
  intents: readonly QueryIntentSignal[],
): readonly EvidenceCandidate[] {
  const retrievalRank = new Map(
    retrievalResults.map((result, index) => [
      result.sourceMetadata.chunkId,
      index + 1,
    ]),
  );
  const anchorRank = new Map(
    anchors.map((anchor, index) => [anchor.sourceMetadata.chunkId, index + 1]),
  );
  let sequence = 0;
  const primary = anchors.map<EvidenceCandidate>((result) => ({
    result,
    contextRole: primaryContextRole(
      result.sourceRole ?? classifySourceRole(result).role,
    ),
    reasons: [
      {
        kind: "retrieved_primary",
        detail: `selected from final retrieval rank ${retrievalRank.get(result.sourceMetadata.chunkId) ?? anchorRank.get(result.sourceMetadata.chunkId) ?? 0}`,
      },
    ],
    retrieval: retrievalProvenance(
      result,
      retrievalRank.get(result.sourceMetadata.chunkId) ?? 0,
    ),
    relationships: relationshipProvenance(result),
    priority: anchorRank.get(result.sourceMetadata.chunkId) ?? 0,
    sequence: sequence++,
  }));
  const localCandidates = local.map<EvidenceCandidate>((candidate) => {
    const sourceRole = classifySourceRole(candidate.result).role;
    return {
      result: candidate.result,
      contextRole: localContextRole(sourceRole),
      reasons: [
        {
          kind: candidate.reason,
          detail: localReasonDetail(candidate, anchors),
        },
      ],
      retrieval: retrievalRank.has(candidate.result.sourceMetadata.chunkId)
        ? retrievalProvenance(
            candidate.result,
            retrievalRank.get(candidate.result.sourceMetadata.chunkId) ?? 0,
          )
        : null,
      relationships: [],
      priority: localPriority(candidate.reason),
      sequence: sequence++,
    };
  });
  const relationshipCandidates = related.map<EvidenceCandidate>((result) => {
    const sourceRole = classifySourceRole(result).role;
    return {
      result,
      contextRole: relationshipContextRole(result, sourceRole),
      reasons: [relationshipReason(result, sourceRole)],
      retrieval: retrievalRank.has(result.sourceMetadata.chunkId)
        ? retrievalProvenance(
            result,
            retrievalRank.get(result.sourceMetadata.chunkId) ?? 0,
          )
        : null,
      relationships: relationshipProvenance(result),
      priority: relationshipPriority(result, sourceRole, intents),
      sequence: sequence++,
    };
  });
  return [...primary, ...localCandidates, ...relationshipCandidates].sort(
    compareCandidates,
  );
}

function compareCandidates(
  left: EvidenceCandidate,
  right: EvidenceCandidate,
): number {
  return (
    left.priority - right.priority ||
    pathDiversityKey(left).localeCompare(pathDiversityKey(right)) ||
    left.sequence - right.sequence ||
    left.result.sourceMetadata.chunkId.localeCompare(
      right.result.sourceMetadata.chunkId,
    )
  );
}

function pathDiversityKey(candidate: EvidenceCandidate): string {
  return (
    candidate.result.path ?? candidate.result.sourceMetadata.sourceReference
  );
}

function deduplicateCandidates(
  candidates: readonly EvidenceCandidate[],
  decisions: EvidencePackDecision[],
): readonly EvidenceCandidate[] {
  const selected: EvidenceCandidate[] = [];
  const byChunkId = new Map<string, EvidenceCandidate>();
  const byContent = new Map<string, EvidenceCandidate>();
  for (const candidate of candidates) {
    const chunkId = candidate.result.sourceMetadata.chunkId;
    const duplicate =
      byChunkId.get(chunkId) ?? byContent.get(candidate.result.content);
    const overlapping = duplicate ?? findCompatibleOverlap(selected, candidate);
    if (overlapping) {
      if (overlapping !== duplicate) {
        mergeOverlappingContent(overlapping, candidate);
      }
      mergeCandidate(overlapping, candidate);
      decisions.push(
        decision(
          overlapping === duplicate ? "deduplicated" : "merged",
          candidate.result,
          candidate.contextRole,
          overlapping === duplicate
            ? "identical chunk or content already present"
            : "overlapping range for the same structural symbol",
          candidate.priority,
          0,
        ),
      );
      continue;
    }
    selected.push(candidate);
    byChunkId.set(chunkId, candidate);
    byContent.set(candidate.result.content, candidate);
  }
  return selected;
}

function findCompatibleOverlap(
  selected: readonly EvidenceCandidate[],
  incoming: EvidenceCandidate,
): EvidenceCandidate | undefined {
  const incomingMetadata = incoming.result.sourceMetadata;
  if (
    !incoming.result.path ||
    incomingMetadata.startLine === null ||
    incomingMetadata.endLine === null
  ) {
    return undefined;
  }
  const incomingStartLine = incomingMetadata.startLine;
  const incomingEndLine = incomingMetadata.endLine;
  return selected.find((candidate) => {
    const metadata = candidate.result.sourceMetadata;
    if (
      candidate.result.path !== incoming.result.path ||
      metadata.startLine === null ||
      metadata.endLine === null ||
      !sameStructuralIdentity(candidate.result, incoming.result)
    ) {
      return false;
    }
    return (
      metadata.startLine <= incomingEndLine &&
      incomingStartLine <= metadata.endLine &&
      canMergeLineContent(candidate.result, incoming.result)
    );
  });
}

function canMergeLineContent(
  left: MemorySearchResult,
  right: MemorySearchResult,
): boolean {
  const leftStart = left.sourceMetadata.startLine;
  const leftEnd = left.sourceMetadata.endLine;
  const rightStart = right.sourceMetadata.startLine;
  const rightEnd = right.sourceMetadata.endLine;
  if (
    leftStart === null ||
    leftEnd === null ||
    rightStart === null ||
    rightEnd === null
  ) {
    return false;
  }
  const leftLines = left.content.split("\n");
  const rightLines = right.content.split("\n");
  if (
    leftLines.length !== leftEnd - leftStart + 1 ||
    rightLines.length !== rightEnd - rightStart + 1
  ) {
    return false;
  }
  const overlapStart = Math.max(leftStart, rightStart);
  const overlapEnd = Math.min(leftEnd, rightEnd);
  for (let line = overlapStart; line <= overlapEnd; line += 1) {
    if (leftLines[line - leftStart] !== rightLines[line - rightStart]) {
      return false;
    }
  }
  return true;
}

function mergeOverlappingContent(
  selected: EvidenceCandidate,
  incoming: EvidenceCandidate,
): void {
  const selectedStart = selected.result.sourceMetadata.startLine;
  const selectedEnd = selected.result.sourceMetadata.endLine;
  const incomingStart = incoming.result.sourceMetadata.startLine;
  const incomingEnd = incoming.result.sourceMetadata.endLine;
  if (
    selectedStart === null ||
    selectedEnd === null ||
    incomingStart === null ||
    incomingEnd === null
  ) {
    return;
  }
  const startLine = Math.min(selectedStart, incomingStart);
  const endLine = Math.max(selectedEnd, incomingEnd);
  const lines = Array<string>(endLine - startLine + 1);
  for (const [result, resultStart] of [
    [selected.result, selectedStart],
    [incoming.result, incomingStart],
  ] as const) {
    result.content
      .split("\n")
      .forEach(
        (line, index) => (lines[resultStart - startLine + index] = line),
      );
  }
  selected.result = {
    ...selected.result,
    content: lines.join("\n"),
    sourceMetadata: {
      ...selected.result.sourceMetadata,
      startLine,
      endLine,
    },
  };
}

function sameStructuralIdentity(
  left: MemorySearchResult,
  right: MemorySearchResult,
): boolean {
  const leftMetadata = left.sourceMetadata;
  const rightMetadata = right.sourceMetadata;
  if (leftMetadata.symbolId && rightMetadata.symbolId) {
    if (
      leftMetadata.symbolId === rightMetadata.symbolId &&
      leftMetadata.symbolPart === rightMetadata.symbolPart
    ) {
      return true;
    }
  }
  return (
    leftMetadata.symbolName !== null &&
    leftMetadata.symbolName === rightMetadata.symbolName &&
    leftMetadata.symbolKind === rightMetadata.symbolKind
  );
}

function mergeCandidate(
  selected: EvidenceCandidate,
  incoming: EvidenceCandidate,
): void {
  for (const reason of incoming.reasons) {
    if (
      !selected.reasons.some(
        (current) =>
          current.kind === reason.kind && current.detail === reason.detail,
      )
    ) {
      selected.reasons.push(reason);
    }
  }
  for (const relationship of incoming.relationships) {
    if (
      !selected.relationships.some(
        (current) =>
          current.type === relationship.type &&
          current.sourcePath === relationship.sourcePath &&
          current.targetPath === relationship.targetPath &&
          current.reason === relationship.reason,
      )
    ) {
      selected.relationships.push(relationship);
    }
  }
}

function applyEvidenceBudget(
  candidates: readonly EvidenceCandidate[],
  maximumCharacters: number,
  decisions: EvidencePackDecision[],
): BudgetResult {
  const primary = candidates.filter((candidate) =>
    candidate.reasons.some((reason) => reason.kind === "retrieved_primary"),
  );
  const supporting = candidates.filter(
    (candidate) =>
      !candidate.reasons.some((reason) => reason.kind === "retrieved_primary"),
  );
  const evidence: EvidenceItem[] = [];
  let usedCharacters = 0;
  let truncatedItems = 0;
  let rejectedItems = 0;

  primary.forEach((candidate, index) => {
    const remaining = maximumCharacters - usedCharacters;
    const remainingPrimary = primary.length - index;
    const fairShare = Math.floor(remaining / remainingPrimary);
    const originalCharacters = characterLength(candidate.result.content);
    const content =
      originalCharacters <= fairShare
        ? candidate.result.content
        : truncateAtLineBoundary(candidate.result.content, fairShare);
    const contentCharacters = characterLength(content);
    const truncated = contentCharacters < originalCharacters;
    if (truncated) truncatedItems += 1;
    usedCharacters += contentCharacters;
    evidence.push(toEvidenceItem(candidate, evidence.length + 1, content));
    decisions.push(
      decision(
        truncated ? "truncated" : "included",
        candidate.result,
        candidate.contextRole,
        truncated
          ? `primary evidence truncated to preserve all ${primary.length} anchors`
          : "primary evidence included",
        candidate.priority,
        usedCharacters,
      ),
    );
  });

  for (const candidate of diversifySupporting(supporting)) {
    const contentCharacters = characterLength(candidate.result.content);
    if (usedCharacters + contentCharacters > maximumCharacters) {
      rejectedItems += 1;
      decisions.push(
        decision(
          "rejected",
          candidate.result,
          candidate.contextRole,
          `budget requires ${contentCharacters} characters with ${maximumCharacters - usedCharacters} remaining`,
          candidate.priority,
          usedCharacters,
        ),
      );
      continue;
    }
    usedCharacters += contentCharacters;
    evidence.push(
      toEvidenceItem(candidate, evidence.length + 1, candidate.result.content),
    );
    decisions.push(
      decision(
        "included",
        candidate.result,
        candidate.contextRole,
        candidate.reasons.map((reason) => reason.kind).join(", "),
        candidate.priority,
        usedCharacters,
      ),
    );
  }
  return { evidence, usedCharacters, truncatedItems, rejectedItems };
}

function diversifySupporting(
  candidates: readonly EvidenceCandidate[],
): readonly EvidenceCandidate[] {
  const remaining = [...candidates];
  const selected: EvidenceCandidate[] = [];
  const pathCounts = new Map<string, number>();
  const roleCounts = new Map<EvidenceContextRole, number>();
  while (remaining.length > 0) {
    remaining.sort((left, right) => {
      const leftPath = pathDiversityKey(left);
      const rightPath = pathDiversityKey(right);
      return (
        left.priority - right.priority ||
        (pathCounts.get(leftPath) ?? 0) - (pathCounts.get(rightPath) ?? 0) ||
        (roleCounts.get(left.contextRole) ?? 0) -
          (roleCounts.get(right.contextRole) ?? 0) ||
        left.sequence - right.sequence ||
        left.result.sourceMetadata.chunkId.localeCompare(
          right.result.sourceMetadata.chunkId,
        )
      );
    });
    const candidate = remaining.shift();
    if (!candidate) break;
    selected.push(candidate);
    const path = pathDiversityKey(candidate);
    pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
    roleCounts.set(
      candidate.contextRole,
      (roleCounts.get(candidate.contextRole) ?? 0) + 1,
    );
  }
  return selected;
}

function toEvidenceItem(
  candidate: EvidenceCandidate,
  order: number,
  content: string,
): EvidenceItem {
  const result = candidate.result;
  const metadata = result.sourceMetadata;
  const sourceRole = result.sourceRole ?? classifySourceRole(result).role;
  const contentCharacters = characterLength(content);
  const originalContentCharacters = characterLength(result.content);
  return {
    order,
    contextRole: candidate.contextRole,
    reasons: candidate.reasons,
    source: {
      sourceType: result.sourceType,
      sourceReference: metadata.sourceReference,
      parentSourceType: metadata.parentSourceType,
      occurredAt: metadata.occurredAt,
      availableAt: metadata.availableAt,
      path: result.path,
      commitSha: metadata.commitSha,
      startLine: metadata.startLine,
      endLine: metadata.endLine,
      language: metadata.language,
      symbolName: metadata.symbolName,
      symbolKind: metadata.symbolKind,
      parentSymbol: metadata.parentSymbol,
      symbolPart: metadata.symbolPart,
      symbolPartCount: metadata.symbolPartCount,
      sourceRole,
    },
    retrieval: candidate.retrieval,
    relationships: candidate.relationships,
    content,
    contentCharacters,
    originalContentCharacters,
    truncated: contentCharacters < originalContentCharacters,
  };
}

function retrievalProvenance(
  result: MemorySearchResult,
  rank: number,
): EvidenceRetrievalProvenance {
  return {
    rank,
    finalRank: result.finalRank ?? null,
    rerankerRank: result.rerankerRank ?? null,
    rrfRank: result.rrfRank ?? null,
    denseRank: result.denseRank ?? null,
    lexicalRank: result.lexicalRank ?? null,
    structuredRank: result.structuredRank ?? null,
    exactSymbolMatch: result.structuredExactMatch === true,
  };
}

function relationshipProvenance(
  result: MemorySearchResult,
): EvidenceRelationshipProvenance[] {
  if (!result.relationshipType || !result.relationshipReason) return [];
  return [
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
      moduleResolutionKind: result.relationshipModuleResolutionKind ?? null,
      targetSymbolKind: result.relationshipTargetSymbolKind ?? null,
      targetStartLine: result.relationshipTargetStartLine ?? null,
      targetEndLine: result.relationshipTargetEndLine ?? null,
      configurationPath: result.relationshipConfigurationPath ?? null,
      configurationCommitSha: result.relationshipConfigurationCommitSha ?? null,
      depth: 1,
      reason: result.relationshipReason,
    },
  ];
}

function relationshipReason(
  result: MemorySearchResult,
  sourceRole: SourceRole,
): EvidenceReason {
  const kind = relationshipReasonKind(result, sourceRole);
  return {
    kind,
    detail:
      result.relationshipReason ??
      `${result.relationshipType ?? "relationship"} from a primary anchor`,
  };
}

function relationshipReasonKind(
  result: MemorySearchResult,
  sourceRole: SourceRole,
): EvidenceReasonKind {
  const relationshipType = result.relationshipType;
  if (isTestRole(sourceRole)) return "representative_test";
  if (sourceRole === "configuration") return "configuration_dependency";
  if (sourceRole === "database_schema" || sourceRole === "migration") {
    return "schema_dependency";
  }
  if (sourceRole === "type_definition") return "type_dependency";
  if (relationshipType === "imported_by") return "imported_by";
  if (relationshipType === "reexports") return "reexport_target";
  return result.relationshipResolution === "exact_symbol"
    ? "imports_symbol"
    : "imports_module";
}

function relationshipContextRole(
  result: MemorySearchResult,
  sourceRole: SourceRole,
): EvidenceContextRole {
  if (isTestRole(sourceRole)) return "TEST";
  if (sourceRole === "configuration") return "CONFIGURATION";
  if (sourceRole === "database_schema" || sourceRole === "migration") {
    return "SCHEMA";
  }
  if (sourceRole === "development_history") return "HISTORY";
  if (sourceRole === "type_definition") return "TYPE_OR_INTERFACE";
  return result.relationshipType === "imported_by"
    ? "CALLER"
    : result.relationshipType === "imports" ||
        result.relationshipType === "reexports"
      ? "DEPENDENCY"
      : "SUPPORTING_IMPLEMENTATION";
}

function primaryContextRole(sourceRole: SourceRole): EvidenceContextRole {
  if (isTestRole(sourceRole)) return "TEST";
  if (sourceRole === "configuration") return "CONFIGURATION";
  if (sourceRole === "database_schema" || sourceRole === "migration") {
    return "SCHEMA";
  }
  if (sourceRole === "development_history") return "HISTORY";
  if (sourceRole === "type_definition") return "TYPE_OR_INTERFACE";
  return "PRIMARY";
}

function localContextRole(sourceRole: SourceRole): EvidenceContextRole {
  if (sourceRole === "type_definition") return "TYPE_OR_INTERFACE";
  return "LOCAL_CONTEXT";
}

function relationshipPriority(
  result: MemorySearchResult,
  sourceRole: SourceRole,
  intents: readonly QueryIntentSignal[],
): number {
  let priority = 30 + (result.relationshipRank ?? 100);
  if (hasIntent(intents, "tests")) {
    priority += sourceRole === "production_implementation" ? -15 : 0;
  } else if (hasIntent(intents, "configuration")) {
    priority +=
      sourceRole === "configuration"
        ? -18
        : result.relationshipType === "imported_by"
          ? -12
          : 0;
  } else if (hasIntent(intents, "database_schema")) {
    priority +=
      sourceRole === "database_schema"
        ? -18
        : sourceRole === "production_implementation"
          ? -10
          : 0;
  } else if (hasIntent(intents, "exact_symbol")) {
    priority += result.relationshipType === "imported_by" ? -5 : -10;
  } else if (hasIntent(intents, "implementation")) {
    priority +=
      sourceRole === "production_implementation"
        ? -12
        : sourceRole === "type_definition"
          ? -8
          : isTestRole(sourceRole)
            ? 4
            : 0;
  }
  return priority;
}

function localPriority(reason: LocalContextCandidate["reason"]): number {
  switch (reason) {
    case "same_symbol_context":
      return 10;
    case "parent_symbol":
      return 11;
    case "structural_neighbor":
      return 14;
    case "fallback_line_context":
      return 18;
  }
}

function localReasonDetail(
  candidate: LocalContextCandidate,
  anchors: readonly MemorySearchResult[],
): string {
  const anchor = anchors.find(
    (item) => item.sourceMetadata.chunkId === candidate.anchorChunkId,
  );
  const anchorName =
    anchor?.sourceMetadata.symbolName ??
    anchor?.path ??
    candidate.anchorChunkId;
  return `${candidate.reason.replaceAll("_", " ")} for primary anchor ${anchorName}`;
}

function hasIntent(
  intents: readonly QueryIntentSignal[],
  intent: QueryIntentSignal["intent"],
): boolean {
  return intents.some((signal) => signal.intent === intent);
}

function isTestRole(sourceRole: SourceRole): boolean {
  return (
    sourceRole === "unit_test" ||
    sourceRole === "integration_test" ||
    sourceRole === "e2e_test"
  );
}

function structuralKey(result: MemorySearchResult): string | null {
  const metadata = result.sourceMetadata;
  if (!result.path || (!metadata.symbolId && !metadata.symbolName)) return null;
  return `${result.path}\u0000${metadata.symbolId ?? metadata.symbolName}\u0000${metadata.symbolPart ?? ""}`;
}

function assertSafeResults(
  results: readonly MemorySearchResult[],
  repositoryId: string,
  cutoff: Date,
): void {
  for (const result of results) {
    if (result.repositoryId !== repositoryId) {
      throw new Error(
        `Context expansion returned cross-repository evidence for '${result.repositoryId}' while building '${repositoryId}'`,
      );
    }
    if (result.sourceMetadata.availableAt.getTime() > cutoff.getTime()) {
      throw new Error(
        `Context expansion returned future evidence '${result.sourceMetadata.sourceReference}' after cutoff '${cutoff.toISOString()}'`,
      );
    }
  }
}

function characterLength(value: string): number {
  return [...value].length;
}

function truncateAtLineBoundary(value: string, maximum: number): string {
  if (maximum <= 0) return "";
  const characters = [...value];
  if (characters.length <= maximum) return value;
  const marker = "\n/* SWEGA: evidence truncated */";
  const markerCharacters = [...marker];
  if (maximum <= markerCharacters.length) {
    return characters.slice(0, maximum).join("");
  }
  const allowed = maximum - markerCharacters.length;
  const prefix = characters.slice(0, allowed).join("");
  const lastNewline = prefix.lastIndexOf("\n");
  const boundedPrefix = lastNewline > 0 ? prefix.slice(0, lastNewline) : prefix;
  return `${boundedPrefix}${marker}`;
}

function validateAnchorLimit(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_CONTEXT_PRIMARY_ANCHORS
  ) {
    throw new Error(
      `Context primary anchor limit must be an integer from 1 to ${MAX_CONTEXT_PRIMARY_ANCHORS}`,
    );
  }
  return value;
}

function validateContextBudget(value: number): number {
  if (!Number.isInteger(value) || value < MIN_CONTEXT_BUDGET) {
    throw new Error(
      `Context budget must be an integer of at least ${MIN_CONTEXT_BUDGET} characters`,
    );
  }
  return value;
}

function validatePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function decision(
  action: EvidencePackDecision["action"],
  result: MemorySearchResult,
  contextRole: EvidenceContextRole | null,
  reason: string,
  budgetPriority: number | null,
  cumulativeCharacters: number,
): EvidencePackDecision {
  return {
    action,
    path: result.path,
    symbolName: result.sourceMetadata.symbolName,
    contextRole,
    reason,
    budgetPriority,
    cumulativeCharacters,
  };
}
