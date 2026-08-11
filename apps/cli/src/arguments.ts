import { parseArgs } from "node:util";

import { z } from "zod";

export const DEFAULT_INGESTION_LIMIT = 100;

export interface IngestArguments {
  command: "ingest";
  repositoryUrl: string;
  limit: number;
  since?: Date;
}

export interface HelpArguments {
  command: "help";
}

export type CliArguments = IngestArguments | HelpArguments;

const limitSchema = z.coerce.number().int().positive().max(1_000);

function parseSince(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `Invalid --since value '${value}'; expected an ISO-8601 date`,
    );
  }

  return date;
}

export function parseCliArguments(args: readonly string[]): CliArguments {
  const parsed = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h", default: false },
      limit: { type: "string" },
      since: { type: "string" },
    },
  });

  if (parsed.values.help || parsed.positionals[0] === "help") {
    return { command: "help" };
  }

  const [command, repositoryUrl, ...unexpected] = parsed.positionals;
  if (command !== "ingest" || !repositoryUrl || unexpected.length > 0) {
    throw new Error(
      "Usage: swega ingest <github-repository-url> [--limit N] [--since ISO_DATE]",
    );
  }

  const limit = limitSchema.parse(
    parsed.values.limit ?? DEFAULT_INGESTION_LIMIT,
  );
  const since = parseSince(parsed.values.since);

  return {
    command: "ingest",
    repositoryUrl,
    limit,
    ...(since ? { since } : {}),
  };
}

export function helpText(): string {
  return [
    "SWEGA repository metadata ingestion",
    "",
    "Usage:",
    "  swega ingest <github-repository-url> [--limit N] [--since ISO_DATE]",
    "",
    "Options:",
    `  --limit N        Maximum records per collection (default: ${DEFAULT_INGESTION_LIMIT})`,
    "  --since DATE     Only ingest records updated at or after an ISO-8601 date",
    "  -h, --help       Show this help",
  ].join("\n");
}
