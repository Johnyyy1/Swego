import { repositoryIdSchema } from "@swega/shared";

import type { SearchMemoryInput } from "./types";

export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 100;

export interface NormalizedSearchMemoryInput {
  repositoryId: string;
  query: string;
  limit: number;
  before: Date;
}

export function normalizeSearchMemoryInput(
  input: SearchMemoryInput,
): NormalizedSearchMemoryInput {
  const repositoryId = repositoryIdSchema.parse(input.repositoryId);
  const query = input.query.trim();
  if (!query) {
    throw new Error("Memory search query must not be empty");
  }
  const limit = input.limit ?? DEFAULT_SEARCH_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
    throw new Error(
      `Memory search limit must be between 1 and ${MAX_SEARCH_LIMIT}`,
    );
  }
  const before = input.before ?? new Date();
  if (Number.isNaN(before.getTime())) {
    throw new Error("Memory search cutoff must be a valid date");
  }

  return { repositoryId, query, limit, before };
}
