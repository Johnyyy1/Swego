import { describe, expect, test } from "bun:test";

import { EMBEDDING_DIMENSIONS } from "@swega/shared";

import { EmbeddingProviderError } from "./types";
import { OllamaEmbeddingProvider, type OllamaFetch } from "./ollama";

describe("OllamaEmbeddingProvider", () => {
  test("parses a batched Ollama embedding response", async () => {
    let requestUrl = "";
    let requestBody: unknown;
    const fakeFetch: OllamaFetch = async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        model: "qwen3-embedding:0.6b",
        embeddings: [unitVector(0), unitVector(1)],
      });
    };
    const provider = new OllamaEmbeddingProvider({ fetch: fakeFetch });

    const vectors = await provider.embed(["first", "second"]);

    expect(requestUrl).toBe("http://localhost:11434/api/embed");
    expect(requestBody).toEqual({
      model: "qwen3-embedding:0.6b",
      input: ["first", "second"],
      dimensions: EMBEDDING_DIMENSIONS,
      truncate: false,
    });
    expect(vectors[0]?.[0]).toBe(1);
    expect(vectors[1]?.[1]).toBe(1);
  });

  test("splits inputs into configured batches while preserving order", async () => {
    const batches: string[][] = [];
    const fakeFetch: OllamaFetch = async (_input, init) => {
      const body: unknown = JSON.parse(String(init?.body));
      if (!isRecord(body) || !isStringArray(body.input)) {
        throw new Error("Expected an Ollama input array");
      }
      batches.push(body.input);
      return Response.json({
        embeddings: body.input.map((_, index) =>
          unitVector(batches.length * 10 + index),
        ),
      });
    };
    const provider = new OllamaEmbeddingProvider({
      batchSize: 2,
      fetch: fakeFetch,
    });

    const vectors = await provider.embed(["a", "b", "c", "d", "e"]);

    expect(batches).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(vectors).toHaveLength(5);
  });

  test("reports an unavailable Ollama server without leaking fetch errors", async () => {
    const fakeFetch: OllamaFetch = async () => {
      throw new Error("socket details");
    };
    const provider = new OllamaEmbeddingProvider({ fetch: fakeFetch });

    const error = await captureError(provider.embed(["query"]));

    expect(error.code).toBe("unavailable");
    expect(error.message).toContain("is Ollama running?");
    expect(error.message).not.toContain("socket details");
  });

  test("reports a missing Ollama model with a pull command", async () => {
    const fakeFetch: OllamaFetch = async () =>
      new Response('{"error":"model not found"}', { status: 404 });
    const provider = new OllamaEmbeddingProvider({ fetch: fakeFetch });

    const error = await captureError(provider.embed(["query"]));

    expect(error.code).toBe("model_unavailable");
    expect(error.message).toContain("ollama pull qwen3-embedding:0.6b");
  });

  test("rejects a malformed Ollama response", async () => {
    const fakeFetch: OllamaFetch = async () =>
      Response.json({ embeddings: "not-a-matrix" });
    const provider = new OllamaEmbeddingProvider({ fetch: fakeFetch });

    const error = await captureError(provider.embed(["query"]));

    expect(error.code).toBe("invalid_response");
  });

  test("rejects unexpected embedding dimensions", async () => {
    const fakeFetch: OllamaFetch = async () =>
      Response.json({ embeddings: [[1, 0]] });
    const provider = new OllamaEmbeddingProvider({ fetch: fakeFetch });

    const error = await captureError(provider.embed(["query"]));

    expect(error.code).toBe("dimension_mismatch");
    expect(error.message).toContain(
      `returned 2 dimensions at input index 0; expected ${EMBEDDING_DIMENSIONS}`,
    );
  });
});

function unitVector(index: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, vectorIndex) =>
    vectorIndex === index % EMBEDDING_DIMENSIONS ? 1 : 0,
  );
}

async function captureError(
  promise: Promise<unknown>,
): Promise<EmbeddingProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EmbeddingProviderError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected promise to reject");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
