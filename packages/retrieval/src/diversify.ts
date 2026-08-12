import type { MemorySearchResult } from "./types";

export interface DiversifyCandidatesOptions {
  limit: number;
  maxCandidatesPerPath: number;
}

/**
 * Keeps bounded structural representation per path while retaining the first
 * exact structured match for a path even when it occurs after the normal cap.
 */
export function diversifyCandidatesByPath(
  candidates: readonly MemorySearchResult[],
  options: DiversifyCandidatesOptions,
): readonly MemorySearchResult[] {
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error("Diversified candidate limit must be a positive integer");
  }
  if (
    !Number.isInteger(options.maxCandidatesPerPath) ||
    options.maxCandidatesPerPath < 1
  ) {
    throw new Error("Per-path candidate limit must be a positive integer");
  }

  const selected: MemorySearchResult[] = [];
  const firstExactByPath = new Map<string, string>();
  for (const candidate of candidates) {
    const path = candidate.path;
    if (
      path !== null &&
      candidate.structuredExactMatch === true &&
      !firstExactByPath.has(path)
    ) {
      firstExactByPath.set(path, candidate.sourceMetadata.chunkId);
    }
  }
  const protectedIds = new Set(
    [...firstExactByPath.values()].slice(0, options.limit),
  );
  let remainingProtected = protectedIds.size;
  const pathCounts = new Map<string, number>();

  for (const candidate of candidates) {
    const protectedExact = protectedIds.has(candidate.sourceMetadata.chunkId);
    if (protectedExact) {
      remainingProtected -= 1;
    } else if (selected.length >= options.limit - remainingProtected) {
      continue;
    }
    const path = candidate.path;
    if (path === null) {
      selected.push(candidate);
      continue;
    }

    const count = pathCounts.get(path) ?? 0;
    const reservesExactSlot =
      firstExactByPath.has(path) &&
      protectedIds.has(firstExactByPath.get(path) ?? "") &&
      !protectedExact;
    const ordinaryLimit =
      options.maxCandidatesPerPath - (reservesExactSlot ? 1 : 0);
    if (!protectedExact && count >= ordinaryLimit) {
      continue;
    }
    if (protectedExact && count >= options.maxCandidatesPerPath) {
      continue;
    }

    selected.push(candidate);
    pathCounts.set(path, count + 1);
  }

  return selected;
}
