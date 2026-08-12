import { describe, expect, test } from "bun:test";

import {
  EmbeddingProviderError,
  type DiagnosableEmbeddingProvider,
} from "@swega/embeddings";
import { RerankerError, type DiagnosableReranker } from "@swega/reranking";
import { EMBEDDING_DIMENSIONS } from "@swega/shared";

import { formatDoctorReport, isDoctorReady, runDoctor } from "./doctor";

describe("swega doctor", () => {
  test("reports ready database and embedding provider without credentials", async () => {
    const report = await runDoctor(
      { check: async () => undefined },
      provider(async () => [unitVector()]),
    );

    expect(isDoctorReady(report)).toBe(true);
    expect(formatDoctorReport(report)).toContain(
      "Embedding provider      ollama",
    );
    expect(formatDoctorReport(report)).toContain(
      "Embedding endpoint      localhost:11434",
    );
  });

  test("reports a missing model with an actionable pull command", async () => {
    const report = await runDoctor(
      { check: async () => undefined },
      provider(async () => {
        throw new EmbeddingProviderError(
          "ollama",
          "qwen3-embedding:0.6b",
          "model_unavailable",
          "model is unavailable",
        );
      }),
    );

    expect(report.providerStatus).toBe("ready");
    expect(report.modelStatus).toBe("missing");
    expect(report.action).toBe("ollama pull qwen3-embedding:0.6b");
  });

  test("reports independent database and provider errors", async () => {
    const report = await runDoctor(
      {
        check: async () => {
          throw new Error("database unavailable");
        },
      },
      provider(async () => {
        throw new EmbeddingProviderError(
          "ollama",
          "qwen3-embedding:0.6b",
          "unavailable",
          "server unavailable",
        );
      }),
    );

    expect(report.databaseStatus).toBe("error");
    expect(report.providerStatus).toBe("error");
    expect(report.modelStatus).toBe("error");
  });

  test("reports a configured local reranker independently", async () => {
    const report = await runDoctor(
      { check: async () => undefined },
      provider(async () => [unitVector()]),
      reranker(async () => [
        { candidateId: "relevant", score: 0.9 },
        { candidateId: "irrelevant", score: 0.1 },
      ]),
    );

    expect(report.reranker).toMatchObject({
      provider: "llama.cpp",
      model: "Qwen3-Reranker-0.6B.Q4_K_M",
      endpoint: "127.0.0.1:8091",
      status: "ready",
    });
    expect(isDoctorReady(report)).toBe(true);
    expect(formatDoctorReport(report)).toContain(
      "Reranker provider       llama.cpp",
    );
  });

  test("reports a missing reranker model with an actionable failure", async () => {
    const report = await runDoctor(
      { check: async () => undefined },
      provider(async () => [unitVector()]),
      reranker(async () => {
        throw new RerankerError(
          "llama.cpp",
          "Qwen3-Reranker-0.6B.Q4_K_M",
          "model_unavailable",
          "model is unavailable",
        );
      }),
    );

    expect(report.reranker?.status).toBe("missing");
    expect(report.reranker?.action).toContain("llama-server");
    expect(isDoctorReady(report)).toBe(false);
  });
});

function provider(
  embed: DiagnosableEmbeddingProvider["embed"],
): DiagnosableEmbeddingProvider {
  return {
    provider: "ollama",
    model: "qwen3-embedding:0.6b",
    dimensions: EMBEDDING_DIMENSIONS,
    endpoint: "http://localhost:11434/api/embed",
    embed,
  };
}

function unitVector(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) =>
    index === 0 ? 1 : 0,
  );
}

function reranker(rerank: DiagnosableReranker["rerank"]): DiagnosableReranker {
  return {
    provider: "llama.cpp",
    model: "Qwen3-Reranker-0.6B.Q4_K_M",
    endpoint: "http://127.0.0.1:8091/v1/rerank",
    rerank,
  };
}
