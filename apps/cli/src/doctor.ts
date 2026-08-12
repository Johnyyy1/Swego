import {
  EmbeddingProviderError,
  type DiagnosableEmbeddingProvider,
} from "@swega/embeddings";
import { RerankerError, type DiagnosableReranker } from "@swega/reranking";

export interface DoctorDatabase {
  check(): Promise<void>;
}

export interface DoctorReport {
  databaseStatus: "ready" | "error";
  embeddingProvider: string;
  embeddingModel: string;
  embeddingEndpoint: string;
  providerStatus: "ready" | "error";
  modelStatus: "ready" | "missing" | "error";
  action?: string;
  reranker?: {
    provider: string;
    model: string;
    endpoint: string;
    status: "ready" | "missing" | "error";
    action?: string;
  };
}

export async function runDoctor(
  database: DoctorDatabase,
  embeddings: DiagnosableEmbeddingProvider,
  reranker: DiagnosableReranker | null = null,
): Promise<DoctorReport> {
  const [databaseResult, providerResult, rerankerResult] =
    await Promise.allSettled([
      database.check(),
      embeddings.embed(["SWEGA embedding provider health check"]),
      reranker
        ? reranker.rerank({
            query: "SWEGA reranker health check",
            candidates: [
              { id: "relevant", text: "SWEGA reranker health check" },
              { id: "irrelevant", text: "unrelated candidate" },
            ],
          })
        : Promise.resolve(null),
    ]);

  let providerStatus: DoctorReport["providerStatus"] = "ready";
  let modelStatus: DoctorReport["modelStatus"] = "ready";
  let action: string | undefined;
  if (providerResult.status === "rejected") {
    if (
      providerResult.reason instanceof EmbeddingProviderError &&
      providerResult.reason.code === "model_unavailable"
    ) {
      modelStatus = "missing";
      if (embeddings.provider === "ollama") {
        action = `ollama pull ${embeddings.model}`;
      }
    } else {
      providerStatus = "error";
      modelStatus = "error";
    }
  }

  const rerankerReport = reranker
    ? describeReranker(reranker, rerankerResult)
    : undefined;

  return {
    databaseStatus: databaseResult.status === "fulfilled" ? "ready" : "error",
    embeddingProvider: embeddings.provider,
    embeddingModel: embeddings.model,
    embeddingEndpoint: endpointHost(embeddings.endpoint),
    providerStatus,
    modelStatus,
    ...(action ? { action } : {}),
    ...(rerankerReport ? { reranker: rerankerReport } : {}),
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const rows = [
    ["Database", report.databaseStatus],
    ["Embedding provider", report.embeddingProvider],
    ["Embedding model", report.embeddingModel],
    ["Embedding endpoint", report.embeddingEndpoint],
    ["Embedding status", report.providerStatus],
    ["Embedding model status", report.modelStatus],
  ];
  if (report.action) {
    rows.push(["Embedding action", report.action]);
  }
  if (report.reranker) {
    rows.push(
      ["Reranker provider", report.reranker.provider],
      ["Reranker model", report.reranker.model],
      ["Reranker endpoint", report.reranker.endpoint],
      ["Reranker status", report.reranker.status],
    );
    if (report.reranker.action) {
      rows.push(["Reranker action", report.reranker.action]);
    }
  }
  return rows
    .map(([label, value]) => `${label?.padEnd(24)}${value}`)
    .join("\n");
}

export function isDoctorReady(report: DoctorReport): boolean {
  return (
    report.databaseStatus === "ready" &&
    report.providerStatus === "ready" &&
    report.modelStatus === "ready" &&
    (report.reranker === undefined || report.reranker.status === "ready")
  );
}

function describeReranker(
  reranker: DiagnosableReranker,
  result: PromiseSettledResult<unknown>,
): NonNullable<DoctorReport["reranker"]> {
  if (result.status === "fulfilled") {
    return {
      provider: reranker.provider,
      model: reranker.model,
      endpoint: endpointHost(reranker.endpoint),
      status: "ready",
    };
  }
  const status =
    result.reason instanceof RerankerError &&
    result.reason.code === "model_unavailable"
      ? "missing"
      : "error";
  return {
    provider: reranker.provider,
    model: reranker.model,
    endpoint: endpointHost(reranker.endpoint),
    status,
    action: `Start llama-server with --reranking --alias '${reranker.model}' at ${new URL(reranker.endpoint).origin}`,
  };
}

function endpointHost(endpoint: string): string {
  const url = new URL(endpoint);
  return url.host || url.hostname || url.protocol.replace(/:$/u, "");
}
