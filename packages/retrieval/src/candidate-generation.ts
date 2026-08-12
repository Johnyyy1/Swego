import { MAX_INTERNAL_CANDIDATE_LIMIT, MAX_SEARCH_LIMIT } from "./search-input";

export const DEFAULT_CANDIDATE_POOL_LIMIT = 50;
export const DEFAULT_BRANCH_CANDIDATE_LIMIT = 300;
export const DEFAULT_FUSION_BRANCH_CANDIDATE_LIMIT = 100;
export const DEFAULT_MAX_CANDIDATES_PER_PATH = 2;

export interface CandidateGenerationConfig {
  candidatePoolLimit: number;
  branchCandidateLimit: number;
  fusionBranchCandidateLimit: number;
  maxCandidatesPerPath: number;
}

export const DEFAULT_CANDIDATE_GENERATION_CONFIG: CandidateGenerationConfig =
  Object.freeze({
    candidatePoolLimit: DEFAULT_CANDIDATE_POOL_LIMIT,
    branchCandidateLimit: DEFAULT_BRANCH_CANDIDATE_LIMIT,
    fusionBranchCandidateLimit: DEFAULT_FUSION_BRANCH_CANDIDATE_LIMIT,
    maxCandidatesPerPath: DEFAULT_MAX_CANDIDATES_PER_PATH,
  });

export function validateCandidateLimit(
  value: number,
  label: string,
  maximum = MAX_SEARCH_LIMIT,
): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(
      `${label} candidate limit must be between 1 and ${maximum}`,
    );
  }
  return value;
}

export function validateBranchCandidateLimit(
  value: number,
  label: string,
): number {
  return validateCandidateLimit(value, label, MAX_INTERNAL_CANDIDATE_LIMIT);
}
