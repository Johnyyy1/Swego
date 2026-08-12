import { parseArgs } from "node:util";

import { z } from "zod";

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
}

export interface BenchmarkArguments {
  command: "benchmark";
  benchmarkFile: string;
  json?: true;
}

export type CliArguments =
  | IngestArguments
  | IngestGitArguments
  | BuildMemoryArguments
  | EmbedMemoryArguments
  | SearchMemoryArguments
  | BenchmarkArguments
  | DoctorArguments
  | HelpArguments;

const ingestionLimitSchema = z.coerce.number().int().positive().max(1_000);
const searchLimitSchema = z.coerce.number().int().positive().max(100);
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
      parsed.values.json
    ) {
      throw new Error("Usage: swega doctor");
    }
    return { command: "doctor" };
  }

  const [command, target, query, ...unexpected] = parsed.positionals;
  if (command === "search") {
    if (
      !target ||
      !query ||
      unexpected.length > 0 ||
      parsed.values.since ||
      parsed.values.json
    ) {
      throw new Error(
        "Usage: swega search <repository-id> <query> [--limit N] [--before ISO_DATE] [--debug]",
      );
    }
    return {
      command,
      repositoryId: repositoryIdSchema.parse(target),
      query,
      limit: searchLimitSchema.parse(
        parsed.values.limit ?? DEFAULT_SEARCH_LIMIT,
      ),
      ...(parsed.values.before
        ? { before: parseDate(parsed.values.before, "before") }
        : {}),
      ...(parsed.values.debug ? { debug: true as const } : {}),
    };
  }

  if (command === "benchmark") {
    if (
      !target ||
      query ||
      unexpected.length > 0 ||
      parsed.values.limit ||
      parsed.values.since ||
      parsed.values.before ||
      parsed.values.debug
    ) {
      throw new Error("Usage: swega benchmark <benchmark-file> [--json]");
    }
    return {
      command,
      benchmarkFile: target,
      ...(parsed.values.json ? { json: true as const } : {}),
    };
  }

  if (!target || query || unexpected.length > 0) {
    throw new Error("Run 'swega --help' for usage");
  }
  if (parsed.values.before) {
    throw new Error("--before applies only to search");
  }
  if (parsed.values.debug) {
    throw new Error("--debug applies only to search");
  }
  if (parsed.values.json) {
    throw new Error("--json applies only to benchmark");
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
    '  swega search <repository-id> "query" [--limit N] [--before ISO_DATE] [--debug]',
    "  swega benchmark <benchmark-file> [--json]",
    "",
    "Options:",
    "  --limit N        Bound ingestion or the number of search results",
    "  --since DATE     Ingest records updated at or after an ISO-8601 date",
    "  --before DATE    Exclude memory unavailable at this historical cutoff",
    "  --debug          Include dense, lexical, and RRF ranking diagnostics",
    "  --json           Emit a machine-readable benchmark report",
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
