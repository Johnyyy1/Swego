import { describe, expect, test } from "bun:test";

import { OllamaEmbeddingProvider } from "./ollama";
import { OpenAIEmbeddingProvider } from "./openai";
import { createEmbeddingProvider } from "./provider";

describe("createEmbeddingProvider", () => {
  test("resolves Ollama by default", () => {
    const provider = createEmbeddingProvider();

    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    expect(provider.provider).toBe("ollama");
    expect(provider.model).toBe("qwen3-embedding:0.6b");
  });

  test("resolves an explicitly configured OpenAI provider", () => {
    const provider = createEmbeddingProvider({
      provider: "openai",
      apiKey: "test-key",
    });

    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(provider.provider).toBe("openai");
  });
});
