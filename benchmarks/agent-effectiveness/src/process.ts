import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ProcessResult {
  command: string[];
  cwd: string;
  exitCode: number | null;
  signalCode: string | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export const runProcess = async ({
  command,
  cwd,
  timeoutMs,
  env,
  stdin,
}: {
  command: string[];
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string | undefined>;
  stdin?: string;
}): Promise<ProcessResult> => {
  const startedAt = performance.now();
  const child = Bun.spawn(command, {
    cwd,
    env: env ?? process.env,
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceKill = setTimeout(() => child.kill("SIGKILL"), 5_000);
  }, timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  if (forceKill) clearTimeout(forceKill);
  return {
    command,
    cwd,
    exitCode,
    signalCode: child.signalCode,
    timedOut,
    durationMs: Math.round(performance.now() - startedAt),
    stdout,
    stderr,
  };
};

export const writeProcessArtifacts = async (
  result: ProcessResult,
  directory: string,
  label: string,
): Promise<{ stdoutArtifact: string; stderrArtifact: string }> => {
  await mkdir(directory, { recursive: true });
  const stdoutArtifact = path.join(directory, `${label}.stdout.txt`);
  const stderrArtifact = path.join(directory, `${label}.stderr.txt`);
  await Promise.all([
    writeFile(stdoutArtifact, result.stdout, { flag: "wx" }),
    writeFile(stderrArtifact, result.stderr, { flag: "wx" }),
  ]);
  return { stdoutArtifact, stderrArtifact };
};
