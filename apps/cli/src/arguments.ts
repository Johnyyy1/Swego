import { parseArgs } from "node:util";

import { z } from "zod";
import {
  DEFAULT_CONTEXT_BUDGET,
  DEFAULT_CONTEXT_PRIMARY_ANCHORS,
  MAX_CONTEXT_PRIMARY_ANCHORS,
  fileEvidenceStrategies,
  intentRolePriorStrategies,
  relationshipExpansionStrategies,
  type FileEvidenceStrategy,
  type IntentRolePriorStrategy,
  type RelationshipExpansionStrategy,
} from "@swega/retrieval";

export const DEFAULT_INGESTION_LIMIT = 100;
export const DEFAULT_SEARCH_LIMIT = 10;

export interface IngestArguments {
  command: "ingest";
  repositoryUrl: string;
  limit: number;
  since?: Date;
}

export interface HelpArguments {
  command: "help";
}

export interface DoctorArguments {
  command: "doctor";
}

export interface IngestGitArguments {
  command: "ingest-git";
  repositoryId: string;
  limit: number;
  since?: Date;
}

export interface BuildMemoryArguments {
  command: "build-memory";
  repositoryId: string;
}

export interface EmbedMemoryArguments {
  command: "embed-memory";
  repositoryId: string;
}

export interface SearchMemoryArguments {
  command: "search";
  repositoryId: string;
  query: string;
  limit: number;
  before?: Date;
  debug?: true;
  rerank?: true;
  candidateLimit?: number;
  pathLimit?: number;
  fileEvidence?: FileEvidenceStrategy;
  relationshipExpansion?: RelationshipExpansionStrategy;
  intentRolePrior?: IntentRolePriorStrategy;
}

export interface ContextArguments {
  command: "context";
  repositoryId: string;
  query: string;
  limit: number;
  contextBudget: number;
  before?: Date;
  debug?: true;
  json?: true;
  rerank?: true;
  candidateLimit?: number;
  pathLimit?: number;
  fileEvidence?: FileEvidenceStrategy;
  relationshipExpansion?: RelationshipExpansionStrategy;
  intentRolePrior?: IntentRolePriorStrategy;
}

export interface BenchmarkArguments {
  command: "benchmark";
  benchmarkFile: string;
  json?: true;
  rerank?: true;
  candidateLimit?: number;
  pathLimit?: number;
  fileEvidence?: FileEvidenceStrategy;
  relationshipExpansion?: RelationshipExpansionStrategy;
  intentRolePrior?: IntentRolePriorStrategy;
}

export interface ContextBenchmarkArguments {
  command: "context-benchmark";
  benchmarkFile: string;
  json?: true;
  rerank?: true;
  candidateLimit?: number;
  pathLimit?: number;
  fileEvidence?: FileEvidenceStrategy;
  relationshipExpansion?: RelationshipExpansionStrategy;
  intentRolePrior?: IntentRolePriorStrategy;
}

export type CliArguments =
  | IngestArguments
  | IngestGitArguments
  | BuildMemoryArguments
  | EmbedMemoryArguments
  | SearchMemoryArguments
  | ContextArguments
  | BenchmarkArguments
  | ContextBenchmarkArguments
  | DoctorArguments
  | HelpArguments;

const ingestionLimitSchema = z.coerce.number().int().positive().max(1_000);
const searchLimitSchema = z.coerce.number().int().positive().max(100);
const contextAnchorLimitSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(MAX_CONTEXT_PRIMARY_ANCHORS);
const contextBudgetSchema = z.coerce.number().int().min(256).max(1_000_000);
const repositoryIdSchema = z.string().uuid();

export function parseCliArguments(args: readonly string[]): CliArguments {
  const parsed = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h", default: false },
      limit: { type: "string" },
      since: { type: "string" },
      before: { type: "string" },
      debug: { type: "boolean" },
      json: { type: "boolean" },
      rerank: { type: "boolean" },
      "candidate-limit": { type: "string" },
      "path-limit": { type: "string" },
      "file-evidence": { type: "string" },
      "relationship-expansion": { type: "string" },
      "intent-role-prior": { type: "string" },
      "context-budget": { type: "string" },
    },
  });

  if (parsed.values.help || parsed.positionals[0] === "help") {
    return { command: "help" };
  }

  if (parsed.positionals[0] === "doctor") {
    if (
      parsed.positionals.length !== 1 ||
      parsed.values.limit ||
      parsed.values.since ||
      parsed.values.before ||
      parsed.values.debug ||
      parsed.values.json ||
      parsed.values.rerank ||
      parsed.values["candidate-limit"] ||
      parsed.values["path-limit"] ||
      parsed.values["file-evidence"] ||
      parsed.values["relationship-expansion"] ||
      parsed.values["intent-role-prior"] ||
      parsed.values["context-budget"]
    ) {
      throw new Error("Usage: swega doctor");
    }
    return { command: "doctor" };
  }

  const [command, target, query, ...unexpected] = parsed.positionals;
  if (command === "search" || command === "context") {
    if (
      !target ||
      !query ||
      unexpected.length > 0 ||
      parsed.values.since ||
      (command === "search" &&
        (parsed.values.json || parsed.values["context-budget"]))
    ) {
      throw new Error(
        command === "search"
          ? "Usage: swega search <repository-id> <query> [--limit N] [--before ISO_DATE] [--rerank] [--candidate-limit N] [--path-limit N] [--file-evidence STRATEGY] [--relationship-expansion STRATEGY] [--intent-role-prior STRATEGY] [--debug]"
          : "Usage: swega context <repository-id> <query> [--limit N] [--context-budget N] [--before ISO_DATE] [--rerank] [--relationship-expansion STRATEGY] [--debug] [--json]",
      );
    }
    if (parsed.values["candidate-limit"] && !parsed.values.rerank) {
      throw new Error("--candidate-limit requires --rerank");
    }
    const shared = {
      repositoryId: repositoryIdSchema.parse(target),
      query,
      ...(parsed.values.before
        ? { before: parseDate(parsed.values.before, "before") }
        : {}),
      ...(parsed.values.debug ? { debug: true as const } : {}),
      ...(parsed.values.rerank ? { rerank: true as const } : {}),
      ...(parsed.values["candidate-limit"]
        ? {
            candidateLimit: searchLimitSchema.parse(
              parsed.values["candidate-limit"],
            ),
          }
        : {}),
      ...(parsed.values["path-limit"]
        ? { pathLimit: searchLimitSchema.parse(parsed.values["path-limit"]) }
        : {}),
      ...(parsed.values["file-evidence"]
        ? {
            fileEvidence: z
              .enum(fileEvidenceStrategies)
              .parse(parsed.values["file-evidence"]),
          }
        : {}),
      ...(parsed.values["relationship-expansion"]
        ? {
            relationshipExpansion: z
              .enum(relationshipExpansionStrategies)
              .parse(parsed.values["relationship-expansion"]),
          }
        : {}),
      ...(parsed.values["intent-role-prior"]
        ? {
            intentRolePrior: z
              .enum(intentRolePriorStrategies)
              .parse(parsed.values["intent-role-prior"]),
          }
        : {}),
    };
    return command === "context"
      ? {
          command,
          ...shared,
          limit: contextAnchorLimitSchema.parse(
            parsed.values.limit ?? DEFAULT_CONTEXT_PRIMARY_ANCHORS,
          ),
          contextBudget: contextBudgetSchema.parse(
            parsed.values["context-budget"] ?? DEFAULT_CONTEXT_BUDGET,
          ),
          ...(parsed.values.json ? { json: true as const } : {}),
        }
      : {
          command,
          ...shared,
          limit: searchLimitSchema.parse(
            parsed.values.limit ?? DEFAULT_SEARCH_LIMIT,
          ),
        };
  }

  if (command === "benchmark" || command === "context-benchmark") {
    if (
      !target ||
      query ||
      unexpected.length > 0 ||
      parsed.values.limit ||
      parsed.values.since ||
      parsed.values.before ||
      parsed.values.debug ||
      parsed.values["context-budget"]
    ) {
      throw new Error(
        `Usage: swega ${command} <benchmark-file> [--rerank] [--candidate-limit N] [--path-limit N] [--file-evidence STRATEGY] [--relationship-expansion STRATEGY] [--intent-role-prior STRATEGY] [--json]`,
      );
    }
    if (parsed.values["candidate-limit"] && !parsed.values.rerank) {
      throw new Error("--candidate-limit requires --rerank");
    }
    return {
      command,
      benchmarkFile: target,
      ...(parsed.values.json ? { json: true as const } : {}),
      ...(parsed.values.rerank ? { rerank: true as const } : {}),
      ...(parsed.values["candidate-limit"]
        ? {
            candidateLimit: searchLimitSchema.parse(
              parsed.values["candidate-limit"],
            ),
          }
        : {}),
      ...(parsed.values["path-limit"]
        ? { pathLimit: searchLimitSchema.parse(parsed.values["path-limit"]) }
        : {}),
      ...(parsed.values["file-evidence"]
        ? {
            fileEvidence: z
              .enum(fileEvidenceStrategies)
              .parse(parsed.values["file-evidence"]),
          }
        : {}),
      ...(parsed.values["relationship-expansion"]
        ? {
            relationshipExpansion: z
              .enum(relationshipExpansionStrategies)
              .parse(parsed.values["relationship-expansion"]),
          }
        : {}),
      ...(parsed.values["intent-role-prior"]
        ? {
            intentRolePrior: z
              .enum(intentRolePriorStrategies)
              .parse(parsed.values["intent-role-prior"]),
          }
        : {}),
    };
  }

  if (!target || query || unexpected.length > 0) {
    throw new Error("Run 'swega --help' for usage");
  }
  if (parsed.values.before) {
    throw new Error("--before applies only to search and context");
  }
  if (parsed.values.debug) {
    throw new Error("--debug applies only to search and context");
  }
  if (parsed.values.json) {
    throw new Error("--json applies only to benchmark and context");
  }
  if (parsed.values.rerank) {
    throw new Error("--rerank applies only to search, context, and benchmark");
  }
  if (
    parsed.values["candidate-limit"] ||
    parsed.values["path-limit"] ||
    parsed.values["file-evidence"] ||
    parsed.values["relationship-expansion"] ||
    parsed.values["intent-role-prior"] ||
    parsed.values["context-budget"]
  ) {
    throw new Error(
      "Candidate generation options apply only to search, context, and benchmark",
    );
  }

  if (command === "ingest" || command === "ingest-git") {
    const limit = ingestionLimitSchema.parse(
      parsed.values.limit ?? DEFAULT_INGESTION_LIMIT,
    );
    const since = parsed.values.since
      ? parseDate(parsed.values.since, "since")
      : undefined;
    return command === "ingest"
      ? {
          command,
          repositoryUrl: target,
          limit,
          ...(since ? { since } : {}),
        }
      : {
          command,
          repositoryId: repositoryIdSchema.parse(target),
          limit,
          ...(since ? { since } : {}),
        };
  }

  if (command === "build-memory" || command === "embed-memory") {
    if (parsed.values.limit || parsed.values.since) {
      throw new Error(`Ingestion options do not apply to ${command}`);
    }
    return {
      command,
      repositoryId: repositoryIdSchema.parse(target),
    };
  }

  throw new Error("Run 'swega --help' for usage");
}

export function helpText(): string {
  return [
    "SWEGA repository memory",
    "",
    "Usage:",
    "  swega doctor",
    "  swega ingest <github-repository-url> [--limit N] [--since ISO_DATE]",
    "  swega ingest-git <repository-id> [--limit N] [--since ISO_DATE]",
    "  swega build-memory <repository-id>",
    "  swega embed-memory <repository-id>",
    '  swega search <repository-id> "query" [--limit N] [--before ISO_DATE] [--rerank] [--candidate-limit N] [--path-limit N] [--file-evidence STRATEGY] [--relationship-expansion STRATEGY] [--intent-role-prior STRATEGY] [--debug]',
    '  swega context <repository-id> "query" [--limit N] [--context-budget N] [--before ISO_DATE] [--rerank] [--relationship-expansion STRATEGY] [--debug] [--json]',
    "  swega benchmark <benchmark-file> [--rerank] [--candidate-limit N] [--path-limit N] [--file-evidence STRATEGY] [--relationship-expansion STRATEGY] [--intent-role-prior STRATEGY] [--json]",
    "  swega context-benchmark <benchmark-file> [--rerank] [--candidate-limit N] [--path-limit N] [--file-evidence STRATEGY] [--relationship-expansion STRATEGY] [--intent-role-prior STRATEGY] [--json]",
    "",
    "Options:",
    "  --limit N        Bound ingestion, search results, or context anchors (maximum 5)",
    "  --since DATE     Ingest records updated at or after an ISO-8601 date",
    "  --before DATE    Exclude memory unavailable at this historical cutoff",
    `  --context-budget N  Bound Evidence Pack content (default: ${DEFAULT_CONTEXT_BUDGET} characters)`,
    "  --debug          Include retrieval and reranker ranking diagnostics",
    "  --relationship-expansion STRATEGY  none or bounded (search default: none; context default: bounded)",
    "  --intent-role-prior STRATEGY  none, weak (default), or moderate",
    "  --rerank         Rerank a bounded hybrid candidate set locally",
    "  --candidate-limit N  Bound the pre-rerank candidate pool",
    "  --path-limit N   Bound pre-rerank chunks retained per file path",
    "  --file-evidence STRATEGY  Select none, max, multi-branch, or bounded-top-n propagation",
    "  --json           Emit a machine-readable benchmark or Evidence Pack",
    "  -h, --help       Show this help",
  ].join("\n");
}

function parseDate(value: string, option: "before" | "since"): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `Invalid --${option} value '${value}'; expected an ISO-8601 date`,
    );
  }
  return date;
}
