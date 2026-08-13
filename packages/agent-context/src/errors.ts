import { EmbeddingProviderError } from "@swega/embeddings";
import { RerankerError } from "@swega/reranking";
import { EmbeddingCompatibilityError } from "@swega/retrieval";

export const agentContextErrorCodes = [
  "INVALID_REPOSITORY_ID",
  "REPOSITORY_NOT_FOUND",
  "REPOSITORY_MEMORY_NOT_READY",
  "INVALID_QUERY",
  "INVALID_CONTEXT_BUDGET",
  "INVALID_TEMPORAL_CUTOFF",
  "EMBEDDING_PROVIDER_UNAVAILABLE",
  "RERANKER_UNAVAILABLE",
  "DATABASE_UNAVAILABLE",
  "INVALID_REQUEST",
  "INTERNAL_ERROR",
] as const;

export type AgentContextErrorCode = (typeof agentContextErrorCodes)[number];

export type AgentContextErrorDetails = Readonly<
  Record<string, string | number | boolean | null>
>;

export interface SerializedAgentContextError {
  code: AgentContextErrorCode;
  message: string;
  details?: AgentContextErrorDetails;
}

export class AgentContextError extends Error {
  override readonly name = "AgentContextError";
  readonly code: AgentContextErrorCode;
  readonly details: AgentContextErrorDetails | undefined;
  override readonly cause: unknown;

  constructor(
    code: AgentContextErrorCode,
    message: string,
    options: { details?: AgentContextErrorDetails; cause?: unknown } = {},
  ) {
    super(message);
    this.code = code;
    this.details = options.details;
    this.cause = options.cause;
  }
}

export function serializeAgentContextError(
  error: AgentContextError,
): SerializedAgentContextError {
  return {
    code: error.code,
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
  };
}

export function mapAgentContextFailure(error: unknown): AgentContextError {
  if (error instanceof AgentContextError) return error;
  if (error instanceof EmbeddingCompatibilityError) {
    return new AgentContextError(
      "REPOSITORY_MEMORY_NOT_READY",
      "Repository memory is not ready for the configured embedding projection.",
      { cause: error },
    );
  }
  if (error instanceof EmbeddingProviderError) {
    return new AgentContextError(
      "EMBEDDING_PROVIDER_UNAVAILABLE",
      "The configured embedding provider is unavailable.",
      {
        cause: error,
        details: { provider: error.provider, model: error.model },
      },
    );
  }
  if (error instanceof RerankerError) {
    return new AgentContextError(
      "RERANKER_UNAVAILABLE",
      "The configured reranker is unavailable.",
      {
        cause: error,
        details: { provider: error.provider, model: error.model },
      },
    );
  }
  if (isDatabaseFailure(error)) {
    return databaseUnavailable(error);
  }
  return new AgentContextError(
    "INTERNAL_ERROR",
    "SWEGA could not complete the context request.",
    { cause: error },
  );
}

export function databaseUnavailable(cause: unknown): AgentContextError {
  return new AgentContextError(
    "DATABASE_UNAVAILABLE",
    "The SWEGA database is unavailable.",
    { cause },
  );
}

function isDatabaseFailure(error: unknown, depth = 0): boolean {
  if (!isRecord(error)) return false;
  const constructorName =
    "constructor" in error &&
    typeof error.constructor === "function" &&
    typeof error.constructor.name === "string"
      ? error.constructor.name
      : "";
  if (constructorName === "PostgresError") return true;
  const code = typeof error.code === "string" ? error.code : "";
  if (
    code.startsWith("ECONN") ||
    code === "CONNECT_TIMEOUT" ||
    code === "ENETUNREACH" ||
    /^[0-9A-Z]{5}$/u.test(code)
  ) {
    return true;
  }
  return depth < 3 && isDatabaseFailure(error.cause, depth + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
