import { EMBEDDING_DIMENSIONS } from "@swega/shared";

import { EmbeddingProviderError, type EmbeddingProvider } from "./types";
import { validateEmbeddings } from "./validate";

export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";

export type EmbeddingFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface OpenAIEmbeddingProviderOptions {
  apiKey: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: EmbeddingFetch;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "openai";
  readonly model: string;
  readonly dimensions: number;
  readonly endpoint: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: EmbeddingFetch;

  constructor(options: OpenAIEmbeddingProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new EmbeddingProviderError(
        this.provider,
        options.model ?? DEFAULT_OPENAI_EMBEDDING_MODEL,
        "invalid_input",
        "API key is required",
      );
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_OPENAI_EMBEDDING_MODEL;
    this.dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
    this.endpoint = `${(options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/u, "")}/embeddings`;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async embed(inputs: readonly string[]): Promise<readonly number[][]> {
    if (inputs.length === 0) {
      return [];
    }
    if (inputs.some((input) => !input.trim())) {
      throw new EmbeddingProviderError(
        this.provider,
        this.model,
        "invalid_input",
        "inputs must not be empty",
      );
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          input: inputs,
          dimensions: this.dimensions,
          encoding_format: "float",
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new EmbeddingProviderError(
        this.provider,
        this.model,
        "unavailable",
        "request failed",
        error,
      );
    }

    if (!response.ok) {
      throw new EmbeddingProviderError(
        this.provider,
        this.model,
        "request_failed",
        `request failed with status ${response.status}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new EmbeddingProviderError(
        this.provider,
        this.model,
        "invalid_response",
        "returned invalid JSON",
        error,
      );
    }
    let embeddings: number[][];
    try {
      embeddings = parseEmbeddingResponse(payload, inputs.length);
    } catch (error) {
      throw new EmbeddingProviderError(
        this.provider,
        this.model,
        "invalid_response",
        "returned an invalid response",
        error,
      );
    }
    return validateEmbeddings(this, inputs, embeddings);
  }
}

function parseEmbeddingResponse(
  payload: unknown,
  expectedCount: number,
): number[][] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("OpenAI embeddings response has no data array");
  }
  const indexed = payload.data.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.index !== "number" ||
      !Number.isInteger(item.index) ||
      !isNumberArray(item.embedding)
    ) {
      throw new Error("OpenAI embeddings response contains invalid data");
    }
    return { index: item.index, embedding: item.embedding };
  });
  indexed.sort((left, right) => left.index - right.index);
  if (
    indexed.length !== expectedCount ||
    indexed.some((item, index) => item.index !== index)
  ) {
    throw new Error("OpenAI embeddings response indexes do not match inputs");
  }
  return indexed.map((item) => item.embedding);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "number")
  );
}
