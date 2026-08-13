import path from "node:path";
import type {
  CommandRecord,
  ParsedMcpCall,
  SwegaCallMetric,
  SwegaMetrics,
  TimestampedCodexEvent,
  ToolMetrics,
  UsageMetrics,
} from "./types.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const eventItem = (
  entry: TimestampedCodexEvent,
): Record<string, unknown> | null => {
  if (!isRecord(entry.event) || !isRecord(entry.event.item)) return null;
  return entry.event.item;
};

export const parseCommands = (
  events: TimestampedCodexEvent[],
): CommandRecord[] => {
  const started = new Map<string, { command: string; elapsedMs: number }>();
  const records: CommandRecord[] = [];
  for (const entry of events) {
    if (!isRecord(entry.event)) continue;
    const item = eventItem(entry);
    if (
      !item ||
      item.type !== "command_execution" ||
      typeof item.id !== "string"
    )
      continue;
    if (
      entry.event.type === "item.started" &&
      typeof item.command === "string"
    ) {
      started.set(item.id, {
        command: item.command,
        elapsedMs: entry.elapsedMs,
      });
    }
    if (
      entry.event.type === "item.completed" &&
      typeof item.command === "string"
    ) {
      const begin = started.get(item.id);
      records.push({
        command: item.command,
        startedElapsedMs: begin?.elapsedMs ?? null,
        completedElapsedMs: entry.elapsedMs,
        exitCode: typeof item.exit_code === "number" ? item.exit_code : null,
        output:
          typeof item.aggregated_output === "string"
            ? item.aggregated_output
            : "",
      });
    }
  }
  return records;
};

export const parseMcpCalls = (
  events: TimestampedCodexEvent[],
): ParsedMcpCall[] => {
  const started = new Map<string, number>();
  const calls: ParsedMcpCall[] = [];
  for (const entry of events) {
    if (!isRecord(entry.event)) continue;
    const item = eventItem(entry);
    if (!item || item.type !== "mcp_tool_call" || typeof item.id !== "string")
      continue;
    if (entry.event.type === "item.started")
      started.set(item.id, entry.elapsedMs);
    if (
      entry.event.type === "item.completed" &&
      typeof item.tool === "string"
    ) {
      calls.push({
        tool: item.tool,
        arguments: isRecord(item.arguments) ? item.arguments : {},
        result: item.result,
        status: typeof item.status === "string" ? item.status : "unknown",
        startedElapsedMs: started.get(item.id) ?? null,
        completedElapsedMs: entry.elapsedMs,
      });
    }
  }
  return calls;
};

const normalizeRepositoryPath = (candidate: string): string | null => {
  const withoutLocation = candidate.replace(/:\d+(?::\d+)?$/, "");
  const cleaned = withoutLocation
    .replace(/^["'`([{]+|["'`\])},;:]+$/g, "")
    .replace(/^\.\//, "");
  if (!cleaned || path.isAbsolute(cleaned) || cleaned.startsWith("-"))
    return null;
  if ([...cleaned].some((character) => "*?[]{}".includes(character)))
    return null;
  if (
    !/\.(?:cjs|css|html|js|json|jsx|md|mjs|prisma|sql|ts|tsx|yaml|yml)$/.test(
      cleaned,
    )
  )
    return null;
  return cleaned;
};

const commandBoundary = String.raw`(?:^|[\s;&|()"'])`;
const directReadTools = new RegExp(
  `${commandBoundary}(?:\\S*\\/)?(?:cat|head|tail|less|sed|awk|nl)\\s`,
);
const searchTools = new RegExp(`${commandBoundary}(?:\\S*\\/)?(?:rg|grep)\\s`);
const discoveryTools = new RegExp(
  `${commandBoundary}(?:\\S*\\/)?(?:find|ls|tree|fd)\\s|git\\s+(?:status|diff|log|show|ls-files)\\b`,
);

const pathsFromCommand = (command: string, output: string): string[] => {
  const candidates = new Set<string>();
  for (const token of command.split(/\s+/)) {
    const normalized = normalizeRepositoryPath(token);
    if (normalized) candidates.add(normalized);
  }
  for (const line of output.split("\n")) {
    const prefix = line.match(/^([^:\s]+\.[A-Za-z0-9]+)(?::\d+)?[:\s]/)?.[1];
    if (prefix) {
      const normalized = normalizeRepositoryPath(prefix);
      if (normalized) candidates.add(normalized);
    }
  }
  return [...candidates].sort();
};

const directReadComponents = (
  command: CommandRecord,
): Array<{ paths: string[]; elapsedMs: number | null }> =>
  command.command
    .split(/&&|\|\||[;|\n]/)
    .filter((component) => directReadTools.test(component))
    .map((component) => ({
      paths: pathsFromCommand(component, ""),
      elapsedMs: command.startedElapsedMs,
    }))
    .filter((component) => component.paths.length > 0);

export const collectToolMetrics = (
  events: TimestampedCodexEvent[],
): ToolMetrics => {
  const commands = parseCommands(events);
  const directReads = commands.flatMap(directReadComponents);
  const fileReadEvents = directReads.flatMap((record) =>
    record.paths.map((filePath) => ({
      path: filePath,
      elapsedMs: record.elapsedMs,
    })),
  );
  const filesRead = new Set(fileReadEvents.map((entry) => entry.path));
  const fileChangeEvents = events.filter(
    (entry) => eventItem(entry)?.type === "file_change",
  );
  return {
    fileReadOperations: directReads.length,
    distinctFilesRead: [...filesRead].sort(),
    searchOperations: commands.filter((record) =>
      searchTools.test(record.command),
    ).length,
    shellDiscoveryOperations: commands.filter((record) =>
      discoveryTools.test(record.command),
    ).length,
    commandExecutions: commands.length,
    fileChangeEvents: fileChangeEvents.length,
    timeToFirstFileReadMs:
      directReads
        .map((record) => record.elapsedMs)
        .find((value) => value !== null) ?? null,
    timeToFirstEditMs: fileChangeEvents[0]?.elapsedMs ?? null,
    fileReadEvents,
  };
};

export const collectUsageMetrics = (
  events: TimestampedCodexEvent[],
): UsageMetrics => {
  const completed = [...events]
    .reverse()
    .map((entry) => entry.event)
    .find(
      (event) =>
        isRecord(event) &&
        event.type === "turn.completed" &&
        isRecord(event.usage),
    );
  const usage =
    isRecord(completed) && isRecord(completed.usage) ? completed.usage : null;
  const numberOrNull = (key: string): number | null =>
    usage && typeof usage[key] === "number" ? usage[key] : null;
  const inputTokens = numberOrNull("input_tokens");
  const outputTokens = numberOrNull("output_tokens");
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: numberOrNull("cached_input_tokens"),
    cacheWriteInputTokens: numberOrNull("cache_write_input_tokens"),
    reasoningOutputTokens: numberOrNull("reasoning_output_tokens"),
    totalTokens:
      inputTokens === null || outputTokens === null
        ? null
        : inputTokens + outputTokens,
  };
};

const structuredContent = (result: unknown): Record<string, unknown> | null => {
  if (!isRecord(result)) return null;
  if (isRecord(result.structured_content)) return result.structured_content;
  if (isRecord(result.structuredContent)) return result.structuredContent;
  return null;
};

const evidenceFiles = (content: Record<string, unknown> | null): string[] => {
  if (!content || !Array.isArray(content.evidence)) return [];
  const files = new Set<string>();
  for (const item of content.evidence) {
    if (
      isRecord(item) &&
      isRecord(item.source) &&
      typeof item.source.path === "string"
    ) {
      files.add(item.source.path);
    }
  }
  return [...files].sort();
};

export const collectSwegaMetrics = (
  condition: "A" | "B",
  events: TimestampedCodexEvent[],
  fileReadEvents: ToolMetrics["fileReadEvents"],
  editedFiles: string[],
  relevantFiles: string[],
): SwegaMetrics => {
  const calls = parseMcpCalls(events).filter((call) =>
    call.tool.startsWith("swega_"),
  );
  const details: SwegaCallMetric[] = calls.map((call) => {
    const content = structuredContent(call.result);
    const files = evidenceFiles(content);
    const budget = content && isRecord(content.budget) ? content.budget : null;
    return {
      tool: call.tool,
      query:
        typeof call.arguments.query === "string" ? call.arguments.query : null,
      durationMs:
        call.startedElapsedMs === null || call.completedElapsedMs === null
          ? null
          : call.completedElapsedMs - call.startedElapsedMs,
      evidenceItemCount:
        content && Array.isArray(content.evidence)
          ? content.evidence.length
          : null,
      contextCharacters:
        budget && typeof budget.usedCharacters === "number"
          ? budget.usedCharacters
          : null,
      surfacedFiles: files,
      relevantFilesSurfaced: files.filter((file) =>
        relevantFiles.includes(file),
      ),
      surfacedFilesLaterOpened: files.filter((file) =>
        fileReadEvents.some(
          (read) =>
            read.path === file &&
            read.elapsedMs !== null &&
            (call.completedElapsedMs === null ||
              read.elapsedMs > call.completedElapsedMs),
        ),
      ),
      surfacedFilesEdited: files.filter((file) => editedFiles.includes(file)),
      succeeded: call.status === "completed",
    };
  });
  return {
    available: condition === "B",
    used: calls.length > 0,
    mcpCallCount: calls.length,
    toolsCalled: [...new Set(calls.map((call) => call.tool))],
    getContextCount: calls.filter((call) => call.tool === "swega_get_context")
      .length,
    calls: details,
  };
};
