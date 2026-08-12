import { describe, expect, test } from "bun:test";

import {
  DEFAULT_LLAMA_CPP_RERANKER_MODEL,
  LlamaCppReranker,
  RerankerError,
  type LlamaCppFetch,
} from "./index";

describe("LlamaCppReranker", () => {
  test("maps complete llama.cpp relevance scores back to candidate IDs", async () => {
    let request: unknown;
    const reranker = new LlamaCppReranker({
      fetch: modelAwareFetch(async (_input, init) => {
        request = JSON.parse(String(init?.body));
        return Response.json({
          model: "Qwen3-Reranker-0.6B.Q4_K_M",
          results: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.2 },
          ],
        });
      }),
    });

    const scores = await reranker.rerank({
      query: "session implementation",
      candidates: [
        { id: "documentation", text: "Authentication documentation" },
        { id: "implementation", text: "function getSession() {}" },
      ],
    });

    expect(request).toEqual({
      model: "Qwen3-Reranker-0.6B.Q4_K_M",
      query: "session implementation",
      top_n: 2,
      documents: ["Authentication documentation", "function getSession() {}"],
    });
    expect(scores).toEqual([
      { candidateId: "implementation", score: 0.9 },
      { candidateId: "documentation", score: 0.2 },
    ]);
  });

  test("rejects malformed, incomplete, and duplicate provider results", async () => {
    const malformedResponses: unknown[] = [
      { results: [{ index: 0, relevance_score: 0.5 }] },
      {
        results: [
          { index: 0, relevance_score: 0.5 },
          { index: 0, relevance_score: 0.4 },
        ],
      },
      {
        results: [
          { index: 0, relevance_score: Number.NaN },
          { index: 1, relevance_score: 0.4 },
        ],
      },
    ];

    for (const payload of malformedResponses) {
      const reranker = new LlamaCppReranker({
        fetch: modelAwareFetch(async () => Response.json(payload)),
      });
      await expect(reranker.rerank(input())).rejects.toMatchObject({
        code: "invalid_response",
      });
    }
  });

  test("reports an unavailable server and model without leaking candidate text", async () => {
    const source = "private repository source";
    const unavailable = new LlamaCppReranker({
      fetch: rejectingFetch(new Error("connection refused")),
    });
    await expect(
      unavailable.rerank({
        query: "session",
        candidates: [{ id: "one", text: source }],
      }),
    ).rejects.toMatchObject({ code: "unavailable" });

    try {
      await unavailable.rerank({
        query: "session",
        candidates: [{ id: "one", text: source }],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(RerankerError);
      expect(String(error)).not.toContain(source);
    }

    const missingModel = new LlamaCppReranker({
      fetch: async () => new Response(null, { status: 404 }),
    });
    await expect(missingModel.rerank(input())).rejects.toMatchObject({
      code: "model_unavailable",
    });

    const wrongModel = new LlamaCppReranker({
      fetch: async () => Response.json({ data: [{ id: "different-model" }] }),
    });
    await expect(wrongModel.rerank(input())).rejects.toMatchObject({
      code: "model_unavailable",
    });
  });

  test("rejects non-loopback endpoints to keep source local", () => {
    expect(
      () => new LlamaCppReranker({ baseUrl: "https://rerank.example.com" }),
    ).toThrow("loopback host");
  });
});

function input() {
  return {
    query: "session",
    candidates: [
      { id: "one", text: "first" },
      { id: "two", text: "second" },
    ],
  };
}

function rejectingFetch(error: Error): LlamaCppFetch {
  return async () => {
    throw error;
  };
}

function modelAwareFetch(rerankFetch: LlamaCppFetch): LlamaCppFetch {
  return async (input, init) => {
    if (String(input).endsWith("/v1/models")) {
      return Response.json({
        data: [{ id: DEFAULT_LLAMA_CPP_RERANKER_MODEL, aliases: [] }],
      });
    }
    return rerankFetch(input, init);
  };
}
