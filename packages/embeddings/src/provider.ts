import {
  OllamaEmbeddingProvider,
  type OllamaEmbeddingProviderOptions,
} from "./ollama";
import {
  OpenAIEmbeddingProvider,
  type OpenAIEmbeddingProviderOptions,
} from "./openai";
import type { DiagnosableEmbeddingProvider } from "./types";

export type EmbeddingProviderConfiguration =
  | ({ provider?: "ollama" } & OllamaEmbeddingProviderOptions)
  | ({ provider: "openai" } & OpenAIEmbeddingProviderOptions);

export function createEmbeddingProvider(
  configuration: EmbeddingProviderConfiguration = {},
): DiagnosableEmbeddingProvider {
  if (configuration.provider === "openai") {
    return new OpenAIEmbeddingProvider(configuration);
  }
  return new OllamaEmbeddingProvider(configuration);
}
