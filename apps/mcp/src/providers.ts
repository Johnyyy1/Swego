import {
  createEmbeddingProvider,
  type DiagnosableEmbeddingProvider,
} from "@swega/embeddings";
import { createReranker, type DiagnosableReranker } from "@swega/reranking";
import type { ServerEnvironment } from "@swega/shared/environment";

export function resolveMcpEmbeddingProvider(
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

export function resolveMcpReranker(
  environment: ServerEnvironment,
): DiagnosableReranker | undefined {
  if (environment.RERANKER_PROVIDER === undefined) return undefined;
  return createReranker({
    provider: "llama.cpp",
    ...(environment.LLAMA_CPP_RERANKER_URL
      ? { baseUrl: environment.LLAMA_CPP_RERANKER_URL }
      : {}),
    ...(environment.LLAMA_CPP_RERANKER_MODEL
      ? { model: environment.LLAMA_CPP_RERANKER_MODEL }
      : {}),
  });
}
