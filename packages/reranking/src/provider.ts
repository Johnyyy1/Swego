import { LlamaCppReranker, type LlamaCppRerankerOptions } from "./llama-cpp";
import type { DiagnosableReranker } from "./types";

export type RerankerConfiguration = {
  provider?: "llama.cpp";
} & LlamaCppRerankerOptions;

export function createReranker(
  configuration: RerankerConfiguration = {},
): DiagnosableReranker {
  return new LlamaCppReranker(configuration);
}
