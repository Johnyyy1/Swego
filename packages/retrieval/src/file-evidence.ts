import { DEFAULT_RRF_K } from "./rrf";
import type {
  FileEvidenceSource,
  FileEvidenceStrategy,
  MemorySearchResult,
  RepresentativeChunkReason,
} from "./types";

export const DEFAULT_FILE_EVIDENCE_FILE_LIMIT = 50;
export const DEFAULT_REPRESENTATIVE_CHUNKS_PER_FILE = 2;
export const DEFAULT_BOUNDED_FILE_CHUNK_COUNT = 2;
export const DEFAULT_RERANK_FILE_EVIDENCE_STRATEGY =
  "multi-branch" satisfies FileEvidenceStrategy;

export interface FileEvidenceOptions {
  strategy: Exclude<FileEvidenceStrategy, "none">;
  query: string;
  rrfK?: number;
  fileLimit?: number;
  representativeChunksPerFile?: number;
  boundedChunkCount?: number;
}

interface ChunkEvidence {
  result: MemorySearchResult;
  ranks: Partial<Record<FileEvidenceSource, number>>;
}

interface FileEvidence {
  path: string;
  chunks: Map<string, ChunkEvidence>;
  sources: Set<FileEvidenceSource>;
  bestRanks: Partial<Record<FileEvidenceSource, number>>;
  score: number;
  bestRank: number;
}

/**
 * Aggregates only bounded, repository/time-filtered branch results. The output
 * is a synthetic rank-only branch; it never mixes provider-specific raw scores.
 */
export function buildFileEvidenceRepresentatives(
  denseResults: readonly MemorySearchResult[],
  lexicalResults: readonly MemorySearchResult[],
  structuredResults: readonly MemorySearchResult[],
  options: FileEvidenceOptions,
): readonly MemorySearchResult[] {
  const k = options.rrfK ?? DEFAULT_RRF_K;
  const fileLimit = options.fileLimit ?? DEFAULT_FILE_EVIDENCE_FILE_LIMIT;
  const representativeLimit =
    options.representativeChunksPerFile ??
    DEFAULT_REPRESENTATIVE_CHUNKS_PER_FILE;
  const boundedChunkCount =
    options.boundedChunkCount ?? DEFAULT_BOUNDED_FILE_CHUNK_COUNT;
  validateOptions(k, fileLimit, representativeLimit, boundedChunkCount);

  const files = new Map<string, FileEvidence>();
  addBranch(files, denseResults, "dense");
  addBranch(files, lexicalResults, "lexical");
  addBranch(files, structuredResults, "structured");

  const rankedFiles = [...files.values()]
    .map((file) => scoreFile(file, options.strategy, k, boundedChunkCount))
    .sort(compareFiles)
    .slice(0, fileLimit);
  const queryTerms = normalizedTerms(options.query);

  return rankedFiles.flatMap((file, index) => {
    const fileEvidenceRank = index + 1;
    const fileEvidenceSources = orderedSources(file.sources);
    return selectRepresentatives(file, queryTerms, representativeLimit).map(
      ({ chunk, reason }) => ({
        ...chunk.result,
        ...branchRankDiagnostics(chunk),
        fileEvidenceRank,
        fileEvidenceSources,
        fileEvidenceScore: file.score,
        representativeChunkReason: reason,
        propagatedFromFileEvidence: true,
      }),
    );
  });
}

function addBranch(
  files: Map<string, FileEvidence>,
  results: readonly MemorySearchResult[],
  source: FileEvidenceSource,
): void {
  const seen = new Set<string>();
  results.forEach((result, index) => {
    const chunkId = result.sourceMetadata.chunkId;
    if (seen.has(chunkId) || result.path === null) {
      return;
    }
    seen.add(chunkId);
    const rank = index + 1;
    const key = `${result.repositoryId}\u0000${result.path}`;
    const file = files.get(key) ?? {
      path: result.path,
      chunks: new Map<string, ChunkEvidence>(),
      sources: new Set<FileEvidenceSource>(),
      bestRanks: {},
      score: 0,
      bestRank: Number.POSITIVE_INFINITY,
    };
    const chunk = file.chunks.get(chunkId) ?? { result, ranks: {} };
    chunk.ranks[source] = rank;
    if (source === "structured" && result.structuredExactMatch === true) {
      chunk.result = result;
    }
    file.chunks.set(chunkId, chunk);
    file.sources.add(source);
    file.bestRanks[source] = Math.min(
      file.bestRanks[source] ?? Number.POSITIVE_INFINITY,
      rank,
    );
    file.bestRank = Math.min(file.bestRank, rank);
    files.set(key, file);
  });
}

function scoreFile(
  file: FileEvidence,
  strategy: FileEvidenceOptions["strategy"],
  k: number,
  boundedChunkCount: number,
): FileEvidence {
  if (strategy === "max") {
    file.score = Math.max(
      ...[...file.chunks.values()].map((chunk) => chunkScore(chunk, k)),
    );
  } else if (strategy === "multi-branch") {
    file.score = orderedSources(file.sources).reduce(
      (score, source) => score + 1 / (k + (file.bestRanks[source] ?? 1)),
      0,
    );
  } else {
    file.score = [...file.chunks.values()]
      .map((chunk) => chunkScore(chunk, k))
      .sort((left, right) => right - left)
      .slice(0, boundedChunkCount)
      .reduce(
        (score, chunkScore_, index) => score + chunkScore_ / (index + 1),
        0,
      );
  }
  return file;
}

function selectRepresentatives(
  file: FileEvidence,
  queryTerms: ReadonlySet<string>,
  limit: number,
): readonly { chunk: ChunkEvidence; reason: RepresentativeChunkReason }[] {
  return [...file.chunks.values()]
    .map((chunk) => ({
      chunk,
      reason: representativeReason(chunk, queryTerms),
      exact: chunk.result.structuredExactMatch === true ? 1 : 0,
      branchCount: Object.keys(chunk.ranks).length,
      overlap: symbolOverlap(chunk.result, queryTerms),
      implementation: implementationWeight(chunk.result),
      bestRank: Math.min(...Object.values(chunk.ranks)),
    }))
    .sort(
      (left, right) =>
        right.exact - left.exact ||
        right.overlap - left.overlap ||
        right.implementation - left.implementation ||
        right.branchCount - left.branchCount ||
        left.bestRank - right.bestRank ||
        left.chunk.result.sourceMetadata.chunkId.localeCompare(
          right.chunk.result.sourceMetadata.chunkId,
        ),
    )
    .slice(0, limit)
    .map(({ chunk, reason }) => ({ chunk, reason }));
}

function representativeReason(
  chunk: ChunkEvidence,
  queryTerms: ReadonlySet<string>,
): RepresentativeChunkReason {
  if (chunk.result.structuredExactMatch === true) {
    return "exact-symbol";
  }
  if (symbolOverlap(chunk.result, queryTerms) > 0) {
    return "query-symbol-overlap";
  }
  if (implementationWeight(chunk.result) > 0) {
    return "implementation-symbol";
  }
  if (Object.keys(chunk.ranks).length > 1) {
    return "multi-branch-chunk";
  }
  return "best-direct-rank";
}

function symbolOverlap(
  result: MemorySearchResult,
  queryTerms: ReadonlySet<string>,
): number {
  const metadata = result.sourceMetadata;
  let overlap = 0;
  for (const term of normalizedTerms(
    [metadata.symbolName, metadata.parentSymbol].filter(Boolean).join(" "),
  )) {
    overlap += queryTerms.has(term) ? 1 : 0;
  }
  return overlap;
}

function implementationWeight(result: MemorySearchResult): number {
  switch (result.sourceMetadata.symbolKind) {
    case "function":
    case "method":
    case "class":
      return 2;
    case "variable":
    case "property":
      return 1;
    default:
      return 0;
  }
}

function chunkScore(chunk: ChunkEvidence, k: number): number {
  return Object.values(chunk.ranks).reduce(
    (score, rank) => score + 1 / (k + rank),
    0,
  );
}

function compareFiles(left: FileEvidence, right: FileEvidence): number {
  const scoreDifference = right.score - left.score;
  return scoreDifference !== 0
    ? scoreDifference
    : left.bestRank !== right.bestRank
      ? left.bestRank - right.bestRank
      : left.path.localeCompare(right.path);
}

function orderedSources(
  sources: ReadonlySet<FileEvidenceSource>,
): readonly FileEvidenceSource[] {
  return (["dense", "lexical", "structured"] as const).filter((source) =>
    sources.has(source),
  );
}

function branchRankDiagnostics(
  chunk: ChunkEvidence,
): Pick<MemorySearchResult, "denseRank" | "lexicalRank" | "structuredRank"> {
  return {
    ...(chunk.ranks.dense === undefined
      ? {}
      : { denseRank: chunk.ranks.dense }),
    ...(chunk.ranks.lexical === undefined
      ? {}
      : { lexicalRank: chunk.ranks.lexical }),
    ...(chunk.ranks.structured === undefined
      ? {}
      : { structuredRank: chunk.ranks.structured }),
  };
}

function normalizedTerms(value: string): Set<string> {
  return new Set(
    value
      .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((term) => term.length > 1),
  );
}

function validateOptions(
  k: number,
  fileLimit: number,
  representativeLimit: number,
  boundedChunkCount: number,
): void {
  if (!Number.isFinite(k) || k < 0) {
    throw new Error("File evidence RRF k must be a non-negative finite number");
  }
  for (const [label, value] of [
    ["File evidence", fileLimit],
    ["Representative chunk", representativeLimit],
    ["Bounded chunk", boundedChunkCount],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${label} limit must be a positive integer`);
    }
  }
}
