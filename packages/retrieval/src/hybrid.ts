import {
  DEFAULT_BRANCH_CANDIDATE_LIMIT,
  DEFAULT_FUSION_BRANCH_CANDIDATE_LIMIT,
  DEFAULT_MAX_CANDIDATES_PER_PATH,
  validateBranchCandidateLimit,
  validateCandidateLimit,
} from "./candidate-generation";
import { diversifyCandidatesByPath } from "./diversify";
import {
  buildFileEvidenceRepresentatives,
  DEFAULT_FILE_EVIDENCE_FILE_LIMIT,
  DEFAULT_REPRESENTATIVE_CHUNKS_PER_FILE,
} from "./file-evidence";
import { normalizeSearchMemoryInput } from "./search-input";
import { DEFAULT_RRF_K, reciprocalRankFusion } from "./rrf";
import { analyzeQueryIntent } from "./query-intent";
import {
  applyIntentRolePrior,
  DEFAULT_INTENT_ROLE_PRIOR_STRATEGY,
  intentRolePriorStrategies,
  type IntentRolePriorStrategy,
} from "./intent-role";
import {
  DEFAULT_RELATIONSHIP_CANDIDATE_LIMIT,
  DEFAULT_RELATIONSHIP_MAX_ANCHORS,
  DEFAULT_RELATIONSHIP_MAX_NEIGHBORS_PER_ANCHOR,
  DEFAULT_RELATIONSHIP_RESERVED_CANDIDATES,
  selectRelationshipAnchors,
  selectCandidatesWithRelationshipReserve,
  type RelationshipExpansion,
} from "./relationship-expansion";
import { fileEvidenceStrategies } from "./types";
import type {
  MemorySearchResult,
  FileEvidenceStrategy,
  RepositoryMemory,
  SearchMemoryInput,
} from "./types";

export const DEFAULT_DENSE_CANDIDATE_LIMIT = DEFAULT_BRANCH_CANDIDATE_LIMIT;
export const DEFAULT_LEXICAL_CANDIDATE_LIMIT = DEFAULT_BRANCH_CANDIDATE_LIMIT;
export const DEFAULT_STRUCTURED_CANDIDATE_LIMIT =
  DEFAULT_BRANCH_CANDIDATE_LIMIT;

export interface HybridRepositoryMemoryOptions {
  denseCandidateLimit?: number;
  lexicalCandidateLimit?: number;
  structuredCandidateLimit?: number;
  fusionBranchCandidateLimit?: number;
  maxCandidatesPerPath?: number;
  rrfK?: number;
  fileEvidenceStrategy?: FileEvidenceStrategy;
  fileEvidenceFileLimit?: number;
  representativeChunksPerFile?: number;
  relationshipExpansion?: RelationshipExpansion;
  relationshipMaxAnchors?: number;
  relationshipMaxNeighborsPerAnchor?: number;
  relationshipCandidateLimit?: number;
  relationshipReservedCandidates?: number;
  intentRolePriorStrategy?: IntentRolePriorStrategy;
}

export class HybridRepositoryMemory implements RepositoryMemory {
  private readonly denseCandidateLimit: number;
  private readonly lexicalCandidateLimit: number;
  private readonly structuredCandidateLimit: number;
  private readonly fusionBranchCandidateLimit: number;
  private readonly maxCandidatesPerPath: number;
  private readonly rrfK: number;
  private readonly fileEvidenceStrategy: FileEvidenceStrategy;
  private readonly fileEvidenceFileLimit: number;
  private readonly representativeChunksPerFile: number;
  private readonly relationshipMaxAnchors: number;
  private readonly relationshipMaxNeighborsPerAnchor: number;
  private readonly relationshipCandidateLimit: number;
  private readonly relationshipReservedCandidates: number;
  private readonly relationshipExpansion: RelationshipExpansion | undefined;
  private readonly intentRolePriorStrategy: IntentRolePriorStrategy;

  constructor(
    private readonly dense: RepositoryMemory,
    private readonly lexical: RepositoryMemory,
    private readonly structured: RepositoryMemory,
    options: HybridRepositoryMemoryOptions = {},
  ) {
    this.denseCandidateLimit = validateBranchCandidateLimit(
      options.denseCandidateLimit ?? DEFAULT_DENSE_CANDIDATE_LIMIT,
      "Dense",
    );
    this.lexicalCandidateLimit = validateBranchCandidateLimit(
      options.lexicalCandidateLimit ?? DEFAULT_LEXICAL_CANDIDATE_LIMIT,
      "Lexical",
    );
    this.structuredCandidateLimit = validateBranchCandidateLimit(
      options.structuredCandidateLimit ?? DEFAULT_STRUCTURED_CANDIDATE_LIMIT,
      "Structured",
    );
    this.fusionBranchCandidateLimit = validateCandidateLimit(
      options.fusionBranchCandidateLimit ??
        DEFAULT_FUSION_BRANCH_CANDIDATE_LIMIT,
      "Fusion branch",
    );
    this.maxCandidatesPerPath = validateCandidateLimit(
      options.maxCandidatesPerPath ?? DEFAULT_MAX_CANDIDATES_PER_PATH,
      "Per-path",
    );
    this.rrfK = options.rrfK ?? DEFAULT_RRF_K;
    if (!Number.isFinite(this.rrfK) || this.rrfK < 0) {
      throw new Error("RRF k must be a non-negative finite number");
    }
    this.fileEvidenceStrategy = options.fileEvidenceStrategy ?? "none";
    if (!fileEvidenceStrategies.includes(this.fileEvidenceStrategy)) {
      throw new Error(
        `Unsupported file evidence strategy '${this.fileEvidenceStrategy}'`,
      );
    }
    this.fileEvidenceFileLimit = validateCandidateLimit(
      options.fileEvidenceFileLimit ?? DEFAULT_FILE_EVIDENCE_FILE_LIMIT,
      "File evidence",
    );
    this.representativeChunksPerFile = validateCandidateLimit(
      options.representativeChunksPerFile ??
        DEFAULT_REPRESENTATIVE_CHUNKS_PER_FILE,
      "Representative chunk",
    );
    this.relationshipMaxAnchors = validateCandidateLimit(
      options.relationshipMaxAnchors ?? DEFAULT_RELATIONSHIP_MAX_ANCHORS,
      "Relationship anchor",
    );
    this.relationshipMaxNeighborsPerAnchor = validateCandidateLimit(
      options.relationshipMaxNeighborsPerAnchor ??
        DEFAULT_RELATIONSHIP_MAX_NEIGHBORS_PER_ANCHOR,
      "Relationship neighbor",
    );
    this.relationshipCandidateLimit = validateCandidateLimit(
      options.relationshipCandidateLimit ??
        DEFAULT_RELATIONSHIP_CANDIDATE_LIMIT,
      "Relationship",
    );
    this.relationshipReservedCandidates =
      options.relationshipReservedCandidates ??
      DEFAULT_RELATIONSHIP_RESERVED_CANDIDATES;
    if (
      !Number.isInteger(this.relationshipReservedCandidates) ||
      this.relationshipReservedCandidates < 0
    ) {
      throw new Error("Relationship reserve must be a non-negative integer");
    }
    this.relationshipExpansion = options.relationshipExpansion;
    this.intentRolePriorStrategy =
      options.intentRolePriorStrategy ?? DEFAULT_INTENT_ROLE_PRIOR_STRATEGY;
    if (!intentRolePriorStrategies.includes(this.intentRolePriorStrategy)) {
      throw new Error(
        `Unsupported intent-role prior strategy '${this.intentRolePriorStrategy}'`,
      );
    }
  }

  async searchMemory(
    input: SearchMemoryInput,
  ): Promise<readonly MemorySearchResult[]> {
    const normalized = normalizeSearchMemoryInput(input);
    const sharedInput = {
      repositoryId: normalized.repositoryId,
      query: normalized.query,
      before: normalized.before,
    };
    const [denseResults, lexicalResults, structuredResults] = await Promise.all(
      [
        this.dense.searchMemory({
          ...sharedInput,
          limit: Math.max(normalized.limit, this.denseCandidateLimit),
        }),
        this.lexical.searchMemory({
          ...sharedInput,
          limit: Math.max(normalized.limit, this.lexicalCandidateLimit),
        }),
        this.structured.searchMemory({
          ...sharedInput,
          limit: Math.max(normalized.limit, this.structuredCandidateLimit),
        }),
      ],
    );
    const queryIntents = analyzeQueryIntent(normalized.query);

    const branchDiversification = {
      limit: Math.max(normalized.limit, this.fusionBranchCandidateLimit),
      maxCandidatesPerPath: this.maxCandidatesPerPath,
    };
    const diversifiedDense = diversifyCandidatesByPath(
      denseResults,
      branchDiversification,
    );
    const diversifiedLexical = diversifyCandidatesByPath(
      lexicalResults,
      branchDiversification,
    );
    const diversifiedStructured = diversifyCandidatesByPath(
      structuredResults,
      branchDiversification,
    );
    const fileEvidenceResults =
      this.fileEvidenceStrategy === "none"
        ? []
        : buildFileEvidenceRepresentatives(
            denseResults,
            lexicalResults,
            structuredResults,
            {
              strategy: this.fileEvidenceStrategy,
              query: normalized.query,
              rrfK: this.rrfK,
              fileLimit: this.fileEvidenceFileLimit,
              representativeChunksPerFile: this.representativeChunksPerFile,
            },
          );
    const initiallyFused = reciprocalRankFusion(
      diversifiedDense,
      diversifiedLexical,
      {
        limit:
          diversifiedDense.length +
          diversifiedLexical.length +
          diversifiedStructured.length,
        k: this.rrfK,
      },
      diversifiedStructured,
      fileEvidenceResults,
    );
    const relationshipResults = this.relationshipExpansion
      ? await this.relationshipExpansion.expand({
          repositoryId: normalized.repositoryId,
          query: normalized.query,
          before: normalized.before,
          anchors: selectRelationshipAnchors(
            initiallyFused,
            this.relationshipMaxAnchors,
          ),
          maxNeighborsPerAnchor: this.relationshipMaxNeighborsPerAnchor,
          candidateLimit: this.relationshipCandidateLimit,
        })
      : [];
    const fusedBeforeIntentRole =
      relationshipResults.length === 0
        ? initiallyFused
        : reciprocalRankFusion(
            diversifiedDense,
            diversifiedLexical,
            {
              limit:
                diversifiedDense.length +
                diversifiedLexical.length +
                diversifiedStructured.length +
                relationshipResults.length,
              k: this.rrfK,
            },
            diversifiedStructured,
            fileEvidenceResults,
            relationshipResults,
          );
    const fused = applyIntentRolePrior(fusedBeforeIntentRole, queryIntents, {
      strategy: this.intentRolePriorStrategy,
      rrfK: this.rrfK,
    });
    const directChunkIds = new Set(
      [...denseResults, ...lexicalResults, ...structuredResults].map(
        (result) => result.sourceMetadata.chunkId,
      ),
    );
    return selectCandidatesWithRelationshipReserve(fused, directChunkIds, {
      limit: normalized.limit,
      maxCandidatesPerPath: this.maxCandidatesPerPath,
      reservedRelationshipCandidates: this.relationshipReservedCandidates,
    }).map((result) => ({
      ...result,
      retrievedDirectly: directChunkIds.has(result.sourceMetadata.chunkId),
    }));
  }
}
