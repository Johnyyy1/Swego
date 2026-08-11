import { describe, expect, test } from "bun:test";

import {
  EmbeddingProviderError,
  type DiagnosableEmbeddingProvider,
} from "@swega/embeddings";
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
      "Embedding provider    ollama",
    );
    expect(formatDoctorReport(report)).toContain(
      "Embedding endpoint    localhost:11434",
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
