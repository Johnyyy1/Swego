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
      `returned ${embeddings.length} vectors for ${inputs.length} inputs`,
    );
  }

  return embeddings.map((embedding, index) => {
    if (
      embedding.length !== provider.dimensions ||
      embedding.some((value) => !Number.isFinite(value))
    ) {
      throw new EmbeddingProviderError(
        provider.provider,
        provider.model,
        `returned an invalid vector at input index ${index}`,
      );
    }
    return [...embedding];
  });
}
