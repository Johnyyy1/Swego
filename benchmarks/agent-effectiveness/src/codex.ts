import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildCodexArguments,
  CODEX_BINARY,
  SOLVER_CONFIGURATION,
} from "./config.ts";
import type { BenchmarkCondition, TimestampedCodexEvent } from "./types.ts";

export interface CodexRunArtifacts {
  exitCode: number | null;
  signalCode: string | null;
  timedOut: boolean;
  durationMs: number;
  events: TimestampedCodexEvent[];
  transcriptArtifact: string;
  stderrArtifact: string;
  finalMessageArtifact: string;
}

const SOLVER_ENVIRONMENT_ALLOWLIST = [
  "BUN_INSTALL",
  "CODEX_CI",
  "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
  "CODEX_PERMISSION_PROFILE",
  "CODEX_SHELL",
  "COLORTERM",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "NO_COLOR",
  "NVM_BIN",
  "NVM_DIR",
  "NVM_INC",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
] as const;

export const buildSolverEnvironment = (
  source: Record<string, string | undefined> = process.env,
): Record<string, string> => ({
  ...Object.fromEntries(
    SOLVER_ENVIRONMENT_ALLOWLIST.flatMap((name) =>
      typeof source[name] === "string" ? [[name, source[name]]] : [],
    ),
  ),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "/usr/bin/false",
});

const parseJsonLine = (line: string): unknown | null => {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
};

export const runCodex = async ({
  condition,
  workspace,
  prompt,
  artifactDirectory,
}: {
  condition: BenchmarkCondition;
  workspace: string;
  prompt: string;
  artifactDirectory: string;
}): Promise<CodexRunArtifacts> => {
  await mkdir(artifactDirectory, { recursive: true });
  const transcriptArtifact = path.join(artifactDirectory, "codex.events.jsonl");
  const stderrArtifact = path.join(artifactDirectory, "codex.stderr.txt");
  const finalMessageArtifact = path.join(artifactDirectory, "codex.final.txt");
  const startedAt = performance.now();
  const child = Bun.spawn(
    [CODEX_BINARY, ...buildCodexArguments(condition, workspace)],
    {
      cwd: workspace,
      env: buildSolverEnvironment(),
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const events: TimestampedCodexEvent[] = [];
  const transcriptLines: string[] = [];
  let pending = "";
  const readStdout = async (): Promise<void> => {
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = parseJsonLine(line);
        if (event === null) continue;
        const elapsedMs = Math.round(performance.now() - startedAt);
        const timestamped = {
          receivedAt: new Date().toISOString(),
          elapsedMs,
          event,
        };
        events.push(timestamped);
        transcriptLines.push(JSON.stringify(timestamped));
      }
    }
    if (pending.trim()) {
      const event = parseJsonLine(pending);
      if (event !== null) {
        const timestamped = {
          receivedAt: new Date().toISOString(),
          elapsedMs: Math.round(performance.now() - startedAt),
          event,
        };
        events.push(timestamped);
        transcriptLines.push(JSON.stringify(timestamped));
      }
    }
  };
  let timedOut = false;
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceKill = setTimeout(
      () => child.kill("SIGKILL"),
      SOLVER_CONFIGURATION.terminationGraceMs,
    );
  }, SOLVER_CONFIGURATION.wallClockTimeoutMs);
  const stderrPromise = new Response(child.stderr).text();
  await Promise.all([readStdout(), child.exited]);
  clearTimeout(timeout);
  if (forceKill) clearTimeout(forceKill);
  const stderr = await stderrPromise;
  const finalMessage = [...events]
    .reverse()
    .map((entry) => entry.event)
    .find(
      (event) =>
        event &&
        typeof event === "object" &&
        "item" in event &&
        typeof (event as { item?: { type?: unknown } }).item === "object" &&
        (event as { item: { type?: unknown } }).item.type === "agent_message",
    ) as { item?: { text?: string } } | undefined;
  await Promise.all([
    writeFile(transcriptArtifact, `${transcriptLines.join("\n")}\n`, {
      flag: "wx",
    }),
    writeFile(stderrArtifact, stderr, { flag: "wx" }),
    writeFile(finalMessageArtifact, finalMessage?.item?.text ?? "", {
      flag: "wx",
    }),
  ]);
  return {
    exitCode: child.exitCode,
    signalCode: child.signalCode,
    timedOut,
    durationMs: Math.round(performance.now() - startedAt),
    events,
    transcriptArtifact,
    stderrArtifact,
    finalMessageArtifact,
  };
};
