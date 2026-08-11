import { EMBEDDING_DIMENSIONS } from "@swega/shared";

import { EmbeddingProviderError, type EmbeddingProvider } from "./types";
import { validateEmbeddings } from "./validate";

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_EMBEDDING_MODEL = "qwen3-embedding:0.6b";
const DEFAULT_OLLAMA_BATCH_SIZE = 64;
const DEFAULT_OLLAMA_TIMEOUT_MS = 60_000;

export type OllamaFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface OllamaEmbeddingProviderOptions {
  baseUrl?: string;
  model?: string;
  dimensions?: number;
  batchSize?: number;
  timeoutMs?: number;
  fetch?: OllamaFetch;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "ollama";
  readonly model: string;
  readonly dimensions: number;
  readonly endpoint: string;
  private readonly batchSize: number;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: OllamaFetch;

  constructor(options: OllamaEmbeddingProviderOptions = {}) {
    this.model = options.model ?? DEFAULT_OLLAMA_EMBEDDING_MODEL;
    this.dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
    this.batchSize = options.batchSize ?? DEFAULT_OLLAMA_BATCH_SIZE;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS;
    this.fetchImplementation = options.fetch ?? fetch;

    if (!Number.isInteger(this.batchSize) || this.batchSize < 1) {
      throw new EmbeddingProviderError(
        this.provider,
        this.model,
        "invalid_input",
        "batch size must be a positive integer",
      );
    }
    if (!Number.isInteger(this.dimensions) || this.dimensions < 1) {
      throw new EmbeddingProviderError(
        this.provider,
        this.model,
        "invalid_input",
        "dimensions must be a positive integer",
      );
    }

    let baseUrl: URL;
    try {
      baseUrl = new URL(options.baseUrl ?? DEFAULT_OLLAMA_URL);
    } catch (error) {
      throw new EmbeddingProviderError(
        this.provider,
        this.model,
        "invalid_input",
        "URL must be valid",
        error,
      );
    }
    if (baseUrl.username || baseUrl.password) {
      throw new EmbeddingProviderError(
        this.provider,
        this.model,
        "invalid_input",
        "URL must not contain credentials",
      );
    }
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      throw new EmbeddingProviderError(
        this.provider,
        this.model,
        "invalid_input",
        "URL must use HTTP or HTTPS",
      );
    }
    this.endpoint = `${baseUrl.toString().replace(/\/$/u, "")}/api/embed`;
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

    const embeddings: number[][] = [];
    for (let offset = 0; offset < inputs.length; offset += this.batchSize) {
      const batch = inputs.slice(offset, offset + this.batchSize);
      embeddings.push(...(await this.embedBatch(batch)));
    }
    return embeddings;
  }

  private async embedBatch(inputs: readonly string[]): Promise<number[][]> {
    let response: Response;
    try {
      response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          input: inputs,
          dimensions: this.dimensions,
          truncate: false,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new EmbeddingProviderError(
        this.provider,
        this.model,
        "unavailable",
        `could not reach Ollama at ${safeOrigin(this.endpoint)}; is Ollama running?`,
        error,
      );
    }

    if (!response.ok) {
      if (response.status === 404) {
        throw new EmbeddingProviderError(
          this.provider,
          this.model,
          "model_unavailable",
          `model is unavailable; run 'ollama pull ${this.model}'`,
        );
      }
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

    if (!isRecord(payload) || !isEmbeddingMatrix(payload.embeddings)) {
      throw new EmbeddingProviderError(
        this.provider,
        this.model,
        "invalid_response",
        "returned an invalid response",
      );
    }
    return validateEmbeddings(this, inputs, payload.embeddings);
  }
}

function safeOrigin(endpoint: string): string {
  return new URL(endpoint).origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEmbeddingMatrix(value: unknown): value is number[][] {
  return (
    Array.isArray(value) &&
    value.every(
      (embedding) =>
        Array.isArray(embedding) &&
        embedding.every((item) => typeof item === "number"),
    )
  );
}
