import { describe, expect, test } from "bun:test";

import { EMBEDDING_DIMENSIONS } from "@swega/shared";

import { OpenAIEmbeddingProvider, type EmbeddingFetch } from "./openai";

describe("OpenAIEmbeddingProvider", () => {
  test("sends a batched, dimension-constrained request and restores input order", async () => {
    let requestBody: unknown;
    const fakeFetch: EmbeddingFetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        data: [
          { index: 1, embedding: unitVector(1) },
          { index: 0, embedding: unitVector(0) },
        ],
      });
    };
    const provider = new OpenAIEmbeddingProvider({
      apiKey: "test-key",
      fetch: fakeFetch,
    });

    const vectors = await provider.embed(["first", "second"]);

    expect(requestBody).toEqual({
      model: "text-embedding-3-small",
      input: ["first", "second"],
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: "float",
    });
    expect(vectors[0]?.[0]).toBe(1);
    expect(vectors[1]?.[1]).toBe(1);
  });

  test("rejects malformed vectors from the provider", async () => {
    const fakeFetch: EmbeddingFetch = async () =>
      Response.json({
        data: [{ index: 0, embedding: [1, 0] }],
      });
    const provider = new OpenAIEmbeddingProvider({
      apiKey: "test-key",
      fetch: fakeFetch,
    });

    await expect(provider.embed(["query"])).rejects.toThrow(
      "returned an invalid vector at input index 0",
    );
  });

  test("does not include provider response bodies in HTTP errors", async () => {
    const fakeFetch: EmbeddingFetch = async () =>
      new Response("secret upstream detail", { status: 429 });
    const provider = new OpenAIEmbeddingProvider({
      apiKey: "test-key",
      fetch: fakeFetch,
    });

    await expect(provider.embed(["query"])).rejects.toThrow(
      "request failed with status 429",
    );
    await expect(provider.embed(["query"])).rejects.not.toThrow(
      "secret upstream detail",
    );
  });
});

function unitVector(index: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, vectorIndex) =>
    vectorIndex === index ? 1 : 0,
  );
}
