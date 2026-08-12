import type {
  MemorySourceType,
  RepositoryId,
  SourceSymbolKind,
} from "@swega/shared";

export interface SearchMemoryInput {
  repositoryId: RepositoryId;
  query: string;
  limit?: number;
  before?: Date;
}

export interface MemorySourceMetadata {
  documentId: string;
  chunkId: string;
  sourceReference: string;
  parentSourceType: MemorySourceType | null;
  parentSourceEntityId: string | null;
  occurredAt: Date;
  availableAt: Date;
  path: string | null;
  commitSha: string | null;
  startLine: number | null;
  endLine: number | null;
  language: string | null;
  symbolId: string | null;
  symbolName: string | null;
  symbolKind: SourceSymbolKind | null;
  parentSymbol: string | null;
  symbolPart: number | null;
  symbolPartCount: number | null;
}

export interface MemorySearchResult {
  repositoryId: RepositoryId;
  content: string;
  /**
   * The legacy dense similarity field. Hybrid lexical-only results use zero
   * because no dense score exists; consumers should use rrfScore for ranking.
   */
  similarity: number;
  sourceType: MemorySourceType;
  sourceId: string;
  timestamp: Date;
  path: string | null;
  sourceMetadata: MemorySourceMetadata;
  denseRank?: number;
  lexicalRank?: number;
  structuredRank?: number;
  denseSimilarity?: number;
  lexicalScore?: number;
  structuredScore?: number;
  structuredExactMatch?: boolean;
  rrfScore?: number;
  rrfRank?: number;
  rerankerScore?: number;
  rerankerRank?: number;
  finalRank?: number;
}

export interface RepositoryMemory {
  searchMemory(
    input: SearchMemoryInput,
  ): Promise<readonly MemorySearchResult[]>;
}

export interface SearchMemoryExecutionDiagnostics {
  candidateGenerationDurationMs: number;
  rerankingDurationMs: number;
  candidateCount: number;
  candidateBytes: number;
}

export interface SearchMemoryExecution {
  results: readonly MemorySearchResult[];
  candidates: readonly MemorySearchResult[];
  diagnostics: SearchMemoryExecutionDiagnostics;
}

export interface DiagnosticRepositoryMemory extends RepositoryMemory {
  searchMemoryWithDiagnostics(
    input: SearchMemoryInput,
  ): Promise<SearchMemoryExecution>;
}

export function supportsSearchMemoryDiagnostics(
  memory: RepositoryMemory,
): memory is DiagnosticRepositoryMemory {
  return "searchMemoryWithDiagnostics" in memory;
}
