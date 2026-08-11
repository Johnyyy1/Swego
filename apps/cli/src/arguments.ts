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

export interface IngestGitArguments {
  command: "ingest-git";
  repositoryId: string;
  limit: number;
  since?: Date;
}

export type CliArguments = IngestArguments | IngestGitArguments | HelpArguments;

const limitSchema = z.coerce.number().int().positive().max(1_000);
const repositoryIdSchema = z.string().uuid();

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

  const [command, target, ...unexpected] = parsed.positionals;
  if (!target || unexpected.length > 0) {
    throw new Error("Run 'swega --help' for usage");
  }

  const limit = limitSchema.parse(
    parsed.values.limit ?? DEFAULT_INGESTION_LIMIT,
  );
  const since = parseSince(parsed.values.since);

  if (command === "ingest") {
    return {
      command,
      repositoryUrl: target,
      limit,
      ...(since ? { since } : {}),
    };
  }

  if (command === "ingest-git") {
    return {
      command,
      repositoryId: repositoryIdSchema.parse(target),
      limit,
      ...(since ? { since } : {}),
    };
  }

  throw new Error("Run 'swega --help' for usage");
}

export function helpText(): string {
  return [
    "SWEGA repository ingestion",
    "",
    "Usage:",
    "  swega ingest <github-repository-url> [--limit N] [--since ISO_DATE]",
    "  swega ingest-git <repository-id> [--limit N] [--since ISO_DATE]",
    "",
    "Options:",
    `  --limit N        Maximum records per collection/history (default: ${DEFAULT_INGESTION_LIMIT})`,
    "  --since DATE     Only ingest records updated at or after an ISO-8601 date",
    "  -h, --help       Show this help",
  ].join("\n");
}
