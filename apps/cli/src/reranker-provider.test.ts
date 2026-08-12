import { describe, expect, test } from "bun:test";

import { LlamaCppReranker } from "@swega/reranking";
import { parseServerEnvironment } from "@swega/shared/environment";

import {
  requireConfiguredReranker,
  resolveConfiguredReranker,
} from "./reranker-provider";

const databaseUrl = "postgresql://postgres:postgres@localhost:5432/swega";

describe("resolveConfiguredReranker", () => {
  test("keeps reranking disabled by default", () => {
    const environment = parseServerEnvironment({ DATABASE_URL: databaseUrl });

    expect(resolveConfiguredReranker(environment)).toBeNull();
    expect(() => requireConfiguredReranker(environment)).toThrow(
      "Reranking is not configured",
    );
  });

  test("resolves an explicitly configured local llama.cpp provider", () => {
    const environment = parseServerEnvironment({
      DATABASE_URL: databaseUrl,
      RERANKER_PROVIDER: "llama.cpp",
      LLAMA_CPP_RERANKER_URL: "http://localhost:8091",
      LLAMA_CPP_RERANKER_MODEL: "fixture-reranker",
    });

    const reranker = requireConfiguredReranker(environment);

    expect(reranker).toBeInstanceOf(LlamaCppReranker);
    expect(reranker.model).toBe("fixture-reranker");
    expect(reranker.endpoint).toBe("http://localhost:8091/v1/rerank");
  });
});
