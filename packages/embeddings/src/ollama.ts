import { EMBEDDING_DIMENSIONS } from "@swega/shared";

import { EmbeddingProviderError, type EmbeddingProvider } from "./types";
import { validateEmbeddings } from "./validate";

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_EMBEDDING_MODEL = "qwen3-embedding:0.6b";
const DEFAULT_OLLAMA_BATCH_SIZE = 64;
const DEFAULT_OLLAMA_CONTEXT_LENGTH = 32_768;
const DEFAULT_OLLAMA_TIMEOUT_MS = 300_000;
const MAX_PROVIDER_ERROR_MESSAGE_LENGTH = 500;

export type OllamaFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface OllamaEmbeddingProviderOptions {
  baseUrl?: string;
  model?: string;
  dimensions?: number;
  batchSize?: number;
  contextLength?: number;
  timeoutMs?: number;
  fetch?: OllamaFetch;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "ollama";
  readonly model: string;
  readonly dimensions: number;
  readonly endpoint: string;
  private readonly batchSize: number;
  private readonly contextLength: number;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: OllamaFetch;

  constructor(options: OllamaEmbeddingProviderOptions = {}) {
    this.model = options.model ?? DEFAULT_OLLAMA_EMBEDDING_MODEL;
    this.dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
    this.batchSize = options.batchSize ?? DEFAULT_OLLAMA_BATCH_SIZE;
    this.contextLength = options.contextLength ?? DEFAULT_OLLAMA_CONTEXT_LENGTH;
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
    if (!Number.isInteger(this.contextLength) || this.contextLength < 1) {
      throw new EmbeddingProviderError(
        this.provider,
        this.model,
        "invalid_input",
        "context length must be a positive integer",
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
    const diagnostics = describeBatch(
      inputs,
      this.dimensions,
      this.model,
      this.contextLength,
    );
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
          options: { num_ctx: this.contextLength },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new EmbeddingProviderError(
          this.provider,
          this.model,
          "request_failed",
          `request timed out after ${this.timeoutMs}ms; ${diagnostics}`,
          error,
        );
      }
      throw new EmbeddingProviderError(
        this.provider,
        this.model,
        "unavailable",
        `could not reach Ollama at ${safeOrigin(this.endpoint)}; is Ollama running?; ${diagnostics}`,
        error,
      );
    }

    if (!response.ok) {
      const providerMessage = await readProviderErrorMessage(response, inputs);
      const responseDetail = providerMessage
        ? `: ${providerMessage}`
        : "; Ollama returned no safe error message";
      if (response.status === 404) {
        throw new EmbeddingProviderError(
          this.provider,
          this.model,
          "model_unavailable",
          `request failed with status ${response.status}${responseDetail}; model is unavailable; run 'ollama pull ${this.model}'; ${diagnostics}`,
        );
      }
      throw new EmbeddingProviderError(
        this.provider,
        this.model,
        "request_failed",
        `request failed with status ${response.status}${responseDetail}; ${diagnostics}`,
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

function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

async function readProviderErrorMessage(
  response: Response,
  inputs: readonly string[],
): Promise<string | null> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(payload) || typeof payload.error !== "string") {
    return null;
  }
  return sanitizeProviderErrorMessage(payload.error, inputs);
}

function sanitizeProviderErrorMessage(
  message: string,
  inputs: readonly string[],
): string | null {
  let normalized = message.replace(/\s+/gu, " ").trim();
  for (const input of inputs) {
    const normalizedInput = input.replace(/\s+/gu, " ").trim();
    if (normalizedInput) {
      normalized = normalized.replaceAll(normalizedInput, "[input redacted]");
    }
  }
  normalized = normalized
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/gu, "[redacted]")
    .replace(/\b(?:sk|gh[pousr])[-_][A-Za-z0-9_-]{8,}\b/gu, "[redacted]")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > MAX_PROVIDER_ERROR_MESSAGE_LENGTH) {
    return `${normalized.slice(0, MAX_PROVIDER_ERROR_MESSAGE_LENGTH)}…`;
  }
  return normalized;
}

function describeBatch(
  inputs: readonly string[],
  dimensions: number,
  model: string,
  contextLength: number,
): string {
  const lengths = inputs.map((input) => input.length);
  return [
    `batchSize=${inputs.length}`,
    `minInputCharacters=${Math.min(...lengths)}`,
    `maxInputCharacters=${Math.max(...lengths)}`,
    `totalInputCharacters=${lengths.reduce((sum, length) => sum + length, 0)}`,
    `requestedDimensions=${dimensions}`,
    `model=${model}`,
    `contextLength=${contextLength}`,
  ].join(", ");
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
