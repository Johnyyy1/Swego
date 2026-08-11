import { createHash } from "node:crypto";

import { EMBEDDING_DIMENSIONS } from "@swega/shared";

import type { EmbeddingProvider } from "./types";

/** Deterministic lexical vectors for tests and pipeline diagnostics only. */
export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "deterministic-test";
  readonly model = "token-hash-v1";
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly endpoint = "memory://deterministic-test";

  async embed(inputs: readonly string[]): Promise<readonly number[][]> {
    return inputs.map((input) => embedText(input, this.dimensions));
  }
}

function embedText(input: string, dimensions: number): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = input.toLowerCase().match(/[a-z0-9_]+/gu) ?? [];
  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    const index = digest.readUInt32BE(0) % dimensions;
    const sign = digest[4] !== undefined && digest[4] % 2 === 0 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign;
  }
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0),
  );
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
}
