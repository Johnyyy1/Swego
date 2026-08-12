export interface RerankCandidate {
  id: string;
  text: string;
}

export interface RerankInput {
  query: string;
  candidates: readonly RerankCandidate[];
}

export interface RerankScore {
  candidateId: string;
  score: number;
}

export interface Reranker {
  readonly provider: string;
  readonly model: string;
  rerank(input: RerankInput): Promise<readonly RerankScore[]>;
}

export interface DiagnosableReranker extends Reranker {
  readonly endpoint: string;
}

export type RerankerErrorCode =
  | "invalid_input"
  | "invalid_response"
  | "model_unavailable"
  | "request_failed"
  | "unavailable";

export class RerankerError extends Error {
  override readonly name = "RerankerError";
  readonly provider: string;
  readonly model: string;
  readonly code: RerankerErrorCode;
  override readonly cause: unknown;

  constructor(
    provider: string,
    model: string,
    code: RerankerErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(`${provider} reranker (${model}): ${message}`);
    this.provider = provider;
    this.model = model;
    this.code = code;
    this.cause = cause;
  }
}
