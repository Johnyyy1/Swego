import { createReranker, type DiagnosableReranker } from "@swega/reranking";
import type { ServerEnvironment } from "@swega/shared/environment";

export function resolveConfiguredReranker(
  environment: ServerEnvironment,
): DiagnosableReranker | null {
  if (environment.RERANKER_PROVIDER === undefined) {
    return null;
  }
  return createReranker({
    provider: "llama.cpp",
    ...(environment.LLAMA_CPP_RERANKER_URL
      ? { baseUrl: environment.LLAMA_CPP_RERANKER_URL }
      : {}),
    ...(environment.LLAMA_CPP_RERANKER_MODEL
      ? { model: environment.LLAMA_CPP_RERANKER_MODEL }
      : {}),
  });
}

export function requireConfiguredReranker(
  environment: ServerEnvironment,
): DiagnosableReranker {
  const reranker = resolveConfiguredReranker(environment);
  if (!reranker) {
    throw new Error(
      "Reranking is not configured. Set RERANKER_PROVIDER=llama.cpp and start a local llama-server with --reranking.",
    );
  }
  return reranker;
}
