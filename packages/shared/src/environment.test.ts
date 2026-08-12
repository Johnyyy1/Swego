import { describe, expect, test } from "bun:test";

import { parseServerEnvironment } from "./environment";

const databaseUrl = "postgresql://postgres:postgres@localhost:5432/swega";

describe("server environment", () => {
  test("defaults to Ollama without requiring an OpenAI API key", () => {
    const environment = parseServerEnvironment({
      DATABASE_URL: databaseUrl,
      RERANKER_PROVIDER: "",
    });

    expect(environment.EMBEDDING_PROVIDER).toBe("ollama");
    expect(environment.OPENAI_API_KEY).toBeUndefined();
    expect(environment.RERANKER_PROVIDER).toBeUndefined();
  });

  test("accepts an explicit Ollama configuration without an OpenAI API key", () => {
    const environment = parseServerEnvironment({
      DATABASE_URL: databaseUrl,
      EMBEDDING_PROVIDER: "ollama",
      OLLAMA_URL: "http://localhost:11434",
      OLLAMA_EMBEDDING_MODEL: "qwen3-embedding:0.6b",
    });

    expect(environment.EMBEDDING_PROVIDER).toBe("ollama");
    expect(environment.OLLAMA_EMBEDDING_MODEL).toBe("qwen3-embedding:0.6b");
  });

  test("requires an OpenAI API key only for the OpenAI provider", () => {
    expect(() =>
      parseServerEnvironment({
        DATABASE_URL: databaseUrl,
        EMBEDDING_PROVIDER: "openai",
      }),
    ).toThrow("OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai");

    expect(
      parseServerEnvironment({
        DATABASE_URL: databaseUrl,
        EMBEDDING_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
      }).OPENAI_API_KEY,
    ).toBe("test-key");
  });

  test("accepts an optional local llama.cpp reranker", () => {
    const environment = parseServerEnvironment({
      DATABASE_URL: databaseUrl,
      RERANKER_PROVIDER: "llama.cpp",
      LLAMA_CPP_RERANKER_URL: "http://127.0.0.1:8091",
      LLAMA_CPP_RERANKER_MODEL: "Qwen3-Reranker-0.6B.Q4_K_M",
    });

    expect(environment.RERANKER_PROVIDER).toBe("llama.cpp");
    expect(environment.LLAMA_CPP_RERANKER_URL).toBe("http://127.0.0.1:8091");
  });
});
