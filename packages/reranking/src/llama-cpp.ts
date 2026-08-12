import {
  RerankerError,
  type DiagnosableReranker,
  type RerankCandidate,
  type RerankerErrorCode,
  type RerankInput,
  type RerankScore,
} from "./types";

export const DEFAULT_LLAMA_CPP_RERANKER_URL = "http://127.0.0.1:8091";
export const DEFAULT_LLAMA_CPP_RERANKER_MODEL = "Qwen3-Reranker-0.6B.Q4_K_M";
const DEFAULT_LLAMA_CPP_RERANKER_TIMEOUT_MS = 300_000;

export type LlamaCppFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface LlamaCppRerankerOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetch?: LlamaCppFetch;
}

export class LlamaCppReranker implements DiagnosableReranker {
  readonly provider = "llama.cpp";
  readonly model: string;
  readonly endpoint: string;
  private readonly modelsEndpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: LlamaCppFetch;

  constructor(options: LlamaCppRerankerOptions = {}) {
    this.model = options.model ?? DEFAULT_LLAMA_CPP_RERANKER_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_LLAMA_CPP_RERANKER_TIMEOUT_MS;
    this.fetchImplementation = options.fetch ?? fetch;

    if (!this.model.trim()) {
      throw this.error("invalid_input", "model must not be empty");
    }
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw this.error(
        "invalid_input",
        "timeout must be a positive integer in milliseconds",
      );
    }

    let baseUrl: URL;
    try {
      baseUrl = new URL(options.baseUrl ?? DEFAULT_LLAMA_CPP_RERANKER_URL);
    } catch (error) {
      throw this.error("invalid_input", "URL must be valid", error);
    }
    if (baseUrl.username || baseUrl.password) {
      throw this.error("invalid_input", "URL must not contain credentials");
    }
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      throw this.error("invalid_input", "URL must use HTTP or HTTPS");
    }
    if (!isLoopbackHostname(baseUrl.hostname)) {
      throw this.error(
        "invalid_input",
        "URL must use a loopback host so repository source stays local",
      );
    }
    if (baseUrl.search || baseUrl.hash) {
      throw this.error(
        "invalid_input",
        "URL must not contain a query or fragment",
      );
    }
    const normalizedBaseUrl = baseUrl.toString().replace(/\/$/u, "");
    this.endpoint = `${normalizedBaseUrl}/v1/rerank`;
    this.modelsEndpoint = `${normalizedBaseUrl}/v1/models`;
  }

  async rerank(input: RerankInput): Promise<readonly RerankScore[]> {
    const query = input.query.trim();
    if (!query) {
      throw this.error("invalid_input", "query must not be empty");
    }
    validateCandidates(input.candidates, (message) =>
      this.error("invalid_input", message),
    );
    if (input.candidates.length === 0) {
      return [];
    }

    await this.assertConfiguredModel();
    const response = await this.request(
      this.endpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          query,
          top_n: input.candidates.length,
          documents: input.candidates.map((candidate) => candidate.text),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
      "reranking request",
    );

    if (!response.ok) {
      const code =
        response.status === 404 ? "model_unavailable" : "request_failed";
      const action =
        response.status === 404
          ? "; ensure llama-server was started with --reranking and the configured model"
          : "";
      throw this.error(
        code,
        `request failed with status ${response.status}${action}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw this.error("invalid_response", "returned invalid JSON", error);
    }
    if (
      isRecord(payload) &&
      typeof payload.model === "string" &&
      payload.model !== this.model
    ) {
      throw this.error(
        "model_unavailable",
        `server returned model '${payload.model}' instead of configured model '${this.model}'`,
      );
    }

    try {
      return parseRerankResponse(payload, input.candidates);
    } catch (error) {
      throw this.error(
        "invalid_response",
        "returned incomplete or malformed scores",
        error,
      );
    }
  }

  private async assertConfiguredModel(): Promise<void> {
    const response = await this.request(
      this.modelsEndpoint,
      { method: "GET", signal: AbortSignal.timeout(this.timeoutMs) },
      "model check",
    );
    if (!response.ok) {
      throw this.error(
        response.status === 404 ? "model_unavailable" : "request_failed",
        `model check failed with status ${response.status}; ensure llama-server exposes /v1/models and was started with --alias ${this.model}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw this.error(
        "invalid_response",
        "model check returned invalid JSON",
        error,
      );
    }
    if (!reportsModel(payload, this.model)) {
      throw this.error(
        "model_unavailable",
        `configured model alias '${this.model}' is not loaded; start llama-server with --alias ${this.model}`,
      );
    }
  }

  private async request(
    endpoint: string,
    init: RequestInit,
    operation: string,
  ): Promise<Response> {
    try {
      return await this.fetchImplementation(endpoint, init);
    } catch (error) {
      if (isTimeoutError(error)) {
        throw this.error(
          "request_failed",
          `${operation} timed out after ${this.timeoutMs}ms`,
          error,
        );
      }
      throw this.error(
        "unavailable",
        `could not reach the local llama.cpp server at ${safeOrigin(this.endpoint)}; start llama-server with --reranking and --alias ${this.model}`,
        error,
      );
    }
  }

  private error(
    code: RerankerErrorCode,
    message: string,
    cause?: unknown,
  ): RerankerError {
    return new RerankerError(this.provider, this.model, code, message, cause);
  }
}

function validateCandidates(
  candidates: readonly RerankCandidate[],
  createError: (message: string) => Error,
): void {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.id.trim()) {
      throw createError("candidate IDs must not be empty");
    }
    if (ids.has(candidate.id)) {
      throw createError(`candidate ID '${candidate.id}' is duplicated`);
    }
    if (!candidate.text.trim()) {
      throw createError(`candidate '${candidate.id}' text must not be empty`);
    }
    ids.add(candidate.id);
  }
}

function parseRerankResponse(
  payload: unknown,
  candidates: readonly RerankCandidate[],
): readonly RerankScore[] {
  const rawResults = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.results)
      ? payload.results
      : null;
  if (!rawResults || rawResults.length !== candidates.length) {
    throw new Error("Reranker result count does not match candidates");
  }

  const indexes = new Set<number>();
  return rawResults.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.index !== "number" ||
      !Number.isInteger(item.index)
    ) {
      throw new Error("Reranker result has an invalid index");
    }
    const index = item.index;
    if (index < 0 || index >= candidates.length || indexes.has(index)) {
      throw new Error(
        "Reranker result index is missing, duplicated, or invalid",
      );
    }
    const score =
      typeof item.relevance_score === "number"
        ? item.relevance_score
        : item.score;
    if (typeof score !== "number" || !Number.isFinite(score)) {
      throw new Error("Reranker result has an invalid score");
    }
    indexes.add(index);
    const candidate = candidates[index];
    if (!candidate) {
      throw new Error("Reranker result references an unknown candidate");
    }
    return { candidateId: candidate.id, score };
  });
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function reportsModel(payload: unknown, model: string): boolean {
  if (!isRecord(payload)) {
    return false;
  }
  const identifiers: string[] = [];
  if (Array.isArray(payload.data)) {
    for (const item of payload.data) {
      if (!isRecord(item)) {
        continue;
      }
      if (typeof item.id === "string") {
        identifiers.push(item.id);
      }
      if (Array.isArray(item.aliases)) {
        identifiers.push(
          ...item.aliases.filter(
            (alias): alias is string => typeof alias === "string",
          ),
        );
      }
    }
  }
  if (Array.isArray(payload.models)) {
    for (const item of payload.models) {
      if (!isRecord(item)) {
        continue;
      }
      if (typeof item.name === "string") {
        identifiers.push(item.name);
      }
      if (typeof item.model === "string") {
        identifiers.push(item.model);
      }
    }
  }
  return identifiers.includes(model);
}

function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function safeOrigin(endpoint: string): string {
  return new URL(endpoint).origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
