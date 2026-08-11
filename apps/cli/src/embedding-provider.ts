import {
  createEmbeddingProvider,
  type DiagnosableEmbeddingProvider,
} from "@swega/embeddings";
import type { ServerEnvironment } from "@swega/shared/environment";

export function resolveConfiguredEmbeddingProvider(
  environment: ServerEnvironment,
): DiagnosableEmbeddingProvider {
  if (environment.EMBEDDING_PROVIDER === "openai") {
    if (!environment.OPENAI_API_KEY) {
      throw new Error(
        "OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai",
      );
    }
    const model =
      environment.OPENAI_EMBEDDING_MODEL ?? environment.SWEGA_EMBEDDING_MODEL;
    return createEmbeddingProvider({
      provider: "openai",
      apiKey: environment.OPENAI_API_KEY,
      ...(model ? { model } : {}),
    });
  }

  return createEmbeddingProvider({
    provider: "ollama",
    ...(environment.OLLAMA_URL ? { baseUrl: environment.OLLAMA_URL } : {}),
    ...(environment.OLLAMA_EMBEDDING_MODEL
      ? { model: environment.OLLAMA_EMBEDDING_MODEL }
      : {}),
  });
}
