export interface EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  embed(inputs: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export class EmbeddingProviderError extends Error {
  override readonly name = "EmbeddingProviderError";
  readonly provider: string;
  readonly model: string;
  override readonly cause: unknown;

  constructor(
    provider: string,
    model: string,
    message: string,
    cause?: unknown,
  ) {
    super(`${provider} embedding provider (${model}): ${message}`);
    this.provider = provider;
    this.model = model;
    this.cause = cause;
  }
}
