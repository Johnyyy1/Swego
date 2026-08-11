import type { EmbeddingProvider } from "./types";
import { EmbeddingProviderError } from "./types";

export function validateEmbeddings(
  provider: EmbeddingProvider,
  inputs: readonly string[],
  embeddings: readonly (readonly number[])[],
): number[][] {
  if (embeddings.length !== inputs.length) {
    throw new EmbeddingProviderError(
      provider.provider,
      provider.model,
      "invalid_response",
      `returned ${embeddings.length} vectors for ${inputs.length} inputs`,
    );
  }

  return embeddings.map((embedding, index) => {
    if (embedding.length !== provider.dimensions) {
      throw new EmbeddingProviderError(
        provider.provider,
        provider.model,
        "dimension_mismatch",
        `returned ${embedding.length} dimensions at input index ${index}; expected ${provider.dimensions}`,
      );
    }
    if (embedding.some((value) => !Number.isFinite(value))) {
      throw new EmbeddingProviderError(
        provider.provider,
        provider.model,
        "invalid_response",
        `returned a non-finite vector at input index ${index}`,
      );
    }
    return [...embedding];
  });
}
