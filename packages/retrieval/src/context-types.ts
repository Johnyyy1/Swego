import type {
  MemorySourceType,
  RepositoryId,
  SourceSymbolKind,
} from "@swega/shared";

import type { QueryIntentSignal } from "./query-intent";
import type { SourceRole } from "./source-role";
import type { MemorySearchResult, RetrievalRelationshipType } from "./types";

export const evidenceContextRoles = [
  "PRIMARY",
  "SUPPORTING_IMPLEMENTATION",
  "TYPE_OR_INTERFACE",
  "CALLER",
  "DEPENDENCY",
  "CONFIGURATION",
  "TEST",
  "SCHEMA",
  "HISTORY",
  "LOCAL_CONTEXT",
] as const;

export type EvidenceContextRole = (typeof evidenceContextRoles)[number];

export const evidenceReasonKinds = [
  "retrieved_primary",
  "same_symbol_context",
  "parent_symbol",
  "structural_neighbor",
  "fallback_line_context",
  "imports_symbol",
  "imports_module",
  "imported_by",
  "reexport_target",
  "type_dependency",
  "representative_test",
  "configuration_dependency",
  "schema_dependency",
] as const;

export type EvidenceReasonKind = (typeof evidenceReasonKinds)[number];

export interface EvidenceReason {
  kind: EvidenceReasonKind;
  detail: string;
}

export interface EvidenceRelationshipProvenance {
  type: RetrievalRelationshipType;
  sourcePath: string | null;
  sourceSymbol: string | null;
  targetPath: string | null;
  targetSymbol: string | null;
  importedName: string | null;
  localName: string | null;
  exposedName: string | null;
  bindingKind: NonNullable<
    MemorySearchResult["relationshipBindingKind"]
  > | null;
  isTypeOnly: boolean;
  resolution: NonNullable<MemorySearchResult["relationshipResolution"]> | null;
  moduleResolutionKind: NonNullable<
    MemorySearchResult["relationshipModuleResolutionKind"]
  > | null;
  targetSymbolKind: SourceSymbolKind | null;
  targetStartLine: number | null;
  targetEndLine: number | null;
  configurationPath: string | null;
  configurationCommitSha: string | null;
  depth: 1;
  reason: string;
}

export interface EvidenceRetrievalProvenance {
  rank: number;
  exactSymbolMatch: boolean;
  /** Detailed rank provenance is present only in explicit debug output. */
  finalRank?: number | null;
  rerankerRank?: number | null;
  rrfRank?: number | null;
  denseRank?: number | null;
  lexicalRank?: number | null;
  structuredRank?: number | null;
}

export interface EvidenceSourceProvenance {
  sourceType: MemorySourceType;
  sourceReference: string;
  parentSourceType: MemorySourceType | null;
  occurredAt: Date;
  availableAt: Date;
  path: string | null;
  commitSha: string | null;
  startLine: number | null;
  endLine: number | null;
  language: string | null;
  symbolName: string | null;
  symbolKind: SourceSymbolKind | null;
  parentSymbol: string | null;
  symbolPart: number | null;
  symbolPartCount: number | null;
  sourceRole: SourceRole;
}

export interface EvidenceItem {
  order: number;
  contextRole: EvidenceContextRole;
  reasons: readonly EvidenceReason[];
  source: EvidenceSourceProvenance;
  retrieval: EvidenceRetrievalProvenance | null;
  relationships: readonly EvidenceRelationshipProvenance[];
  content: string;
  contentCharacters: number;
  originalContentCharacters: number;
  truncated: boolean;
}

export interface EvidencePackRepository {
  id: RepositoryId;
  provider: string;
  owner: string;
  name: string;
  url: string;
  defaultBranch: string | null;
}

export interface EvidencePackBudget {
  maximumCharacters: number;
  usedCharacters: number;
  remainingCharacters: number;
  estimatedTokens: number;
  truncatedItems: number;
  rejectedItems: number;
}

export type EvidencePackDecisionAction =
  | "anchor_selected"
  | "anchor_rejected"
  | "included"
  | "rejected"
  | "deduplicated"
  | "merged"
  | "truncated";

export interface EvidencePackDecision {
  action: EvidencePackDecisionAction;
  path: string | null;
  symbolName: string | null;
  contextRole: EvidenceContextRole | null;
  reason: string;
  budgetPriority: number | null;
  cumulativeCharacters: number;
}

export interface EvidencePackTimings {
  searchDurationMs: number;
  contextExpansionDurationMs: number;
  totalDurationMs: number;
  rerankingDurationMs: number;
  totalExcludingRerankerMs: number;
}

export interface EvidencePackDiagnostics {
  decisions: readonly EvidencePackDecision[];
  timings: EvidencePackTimings;
}

export interface EvidencePack {
  schemaVersion: 1;
  repository: EvidencePackRepository;
  query: string;
  cutoff: Date;
  revisions: readonly string[];
  intents: readonly QueryIntentSignal[];
  evidence: readonly EvidenceItem[];
  budget: EvidencePackBudget;
  diagnostics?: EvidencePackDiagnostics;
}

export interface BuildEvidencePackInput {
  repositoryId: RepositoryId;
  query: string;
  before?: Date;
  limit?: number;
  contextBudget?: number;
  debug?: boolean;
}

export type LocalContextReason = Extract<
  EvidenceReasonKind,
  | "same_symbol_context"
  | "parent_symbol"
  | "structural_neighbor"
  | "fallback_line_context"
>;

export interface LocalContextCandidate {
  anchorChunkId: string;
  result: MemorySearchResult;
  reason: LocalContextReason;
}

export interface LoadLocalContextInput {
  repositoryId: RepositoryId;
  before: Date;
  anchors: readonly MemorySearchResult[];
}

export interface ContextEvidenceSource {
  loadRepository(repositoryId: RepositoryId): Promise<EvidencePackRepository>;
  loadLocalContext(
    input: LoadLocalContextInput,
  ): Promise<readonly LocalContextCandidate[]>;
}

export interface EvidencePackExecution {
  pack: EvidencePack;
  retrievalResults: readonly MemorySearchResult[];
}
