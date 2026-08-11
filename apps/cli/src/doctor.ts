import {
  EmbeddingProviderError,
  type DiagnosableEmbeddingProvider,
} from "@swega/embeddings";

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
}

export async function runDoctor(
  database: DoctorDatabase,
  embeddings: DiagnosableEmbeddingProvider,
): Promise<DoctorReport> {
  const [databaseResult, providerResult] = await Promise.allSettled([
    database.check(),
    embeddings.embed(["SWEGA embedding provider health check"]),
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

  return {
    databaseStatus: databaseResult.status === "fulfilled" ? "ready" : "error",
    embeddingProvider: embeddings.provider,
    embeddingModel: embeddings.model,
    embeddingEndpoint: endpointHost(embeddings.endpoint),
    providerStatus,
    modelStatus,
    ...(action ? { action } : {}),
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const rows = [
    ["Database", report.databaseStatus],
    ["Embedding provider", report.embeddingProvider],
    ["Embedding model", report.embeddingModel],
    ["Embedding endpoint", report.embeddingEndpoint],
    ["Provider status", report.providerStatus],
    ["Model status", report.modelStatus],
  ];
  if (report.action) {
    rows.push(["Action", report.action]);
  }
  return rows
    .map(([label, value]) => `${label?.padEnd(22)}${value}`)
    .join("\n");
}

export function isDoctorReady(report: DoctorReport): boolean {
  return (
    report.databaseStatus === "ready" &&
    report.providerStatus === "ready" &&
    report.modelStatus === "ready"
  );
}

function endpointHost(endpoint: string): string {
  const url = new URL(endpoint);
  return url.host || url.hostname || url.protocol.replace(/:$/u, "");
}
