import { describe, expect, test } from "bun:test";

import {
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
} from "@swega/embeddings";
import { parseServerEnvironment } from "@swega/shared/environment";

import { resolveConfiguredEmbeddingProvider } from "./embedding-provider";

const databaseUrl = "postgresql://postgres:postgres@localhost:5432/swega";

describe("resolveConfiguredEmbeddingProvider", () => {
  test("resolves the default local provider without OpenAI credentials", () => {
    const environment = parseServerEnvironment({ DATABASE_URL: databaseUrl });

    const provider = resolveConfiguredEmbeddingProvider(environment);

    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    expect(provider.model).toBe("qwen3-embedding:0.6b");
  });

  test("resolves the optional OpenAI provider when configured", () => {
    const environment = parseServerEnvironment({
      DATABASE_URL: databaseUrl,
      EMBEDDING_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
    });

    const provider = resolveConfiguredEmbeddingProvider(environment);

    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(provider.model).toBe("text-embedding-3-small");
  });
});
