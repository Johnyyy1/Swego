export interface EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  embed(inputs: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export interface DiagnosableEmbeddingProvider extends EmbeddingProvider {
  readonly endpoint: string;
}

export type EmbeddingProviderErrorCode =
  | "dimension_mismatch"
  | "invalid_input"
  | "invalid_response"
  | "model_unavailable"
  | "request_failed"
  | "unavailable";

export class EmbeddingProviderError extends Error {
  override readonly name = "EmbeddingProviderError";
  readonly provider: string;
  readonly model: string;
  readonly code: EmbeddingProviderErrorCode;
  override readonly cause: unknown;

  constructor(
    provider: string,
    model: string,
    code: EmbeddingProviderErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(`${provider} embedding provider (${model}): ${message}`);
    this.provider = provider;
    this.model = model;
    this.code = code;
    this.cause = cause;
  }
}
