import { access, cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { PRIVATE_BUNDLE_PATH, RUNTIME_ROOT } from "./paths.ts";
import { unpackPrivateBundle } from "./private-bundle.ts";
import { runProcess, writeProcessArtifacts } from "./process.ts";
import type { PrivateTaskDefinition, TestResult } from "./types.ts";
import { loadPublicTasks } from "./schema.ts";

interface PrivateManifest {
  schemaVersion: 1;
  tasks: PrivateTaskDefinition[];
}

const privateRuntime = (nonce: string): string =>
  path.join(RUNTIME_ROOT, "private", nonce);

export const openPrivateArtifacts = async (nonce: string): Promise<string> => {
  const destination = privateRuntime(nonce);
  await mkdir(path.dirname(destination), { recursive: true });
  await mkdir(destination, { recursive: false });
  await unpackPrivateBundle(PRIVATE_BUNDLE_PATH, destination);
  return destination;
};

export const closePrivateArtifacts = async (
  directory: string,
): Promise<void> => {
  if (
    !path
      .resolve(directory)
      .startsWith(path.resolve(RUNTIME_ROOT, "private") + path.sep)
  ) {
    throw new Error(
      `Refusing to remove unexpected private runtime: ${directory}`,
    );
  }
  await rm(directory, { recursive: true });
};

export const loadPrivateTask = async (
  privateDirectory: string,
  taskId: string,
): Promise<PrivateTaskDefinition> => {
  const value = JSON.parse(
    await readFile(path.join(privateDirectory, "manifest.json"), "utf8"),
  ) as PrivateManifest;
  if (value.schemaVersion !== 1 || !Array.isArray(value.tasks))
    throw new Error("Invalid private manifest");
  const task = value.tasks.find((entry) => entry.taskId === taskId);
  if (!task) throw new Error(`Private task not found: ${taskId}`);
  return task;
};

export const validatePrivateArtifacts = async (
  privateDirectory: string,
): Promise<void> => {
  const value = JSON.parse(
    await readFile(path.join(privateDirectory, "manifest.json"), "utf8"),
  ) as PrivateManifest;
  if (value.schemaVersion !== 1 || !Array.isArray(value.tasks))
    throw new Error("Invalid private manifest");
  const publicTasks = await loadPublicTasks();
  const publicIds = new Set(publicTasks.map((task) => task.id));
  const privateIds = new Set<string>();
  for (const task of value.tasks) {
    if (!publicIds.has(task.taskId) || privateIds.has(task.taskId)) {
      throw new Error(`Invalid or duplicate private task: ${task.taskId}`);
    }
    privateIds.add(task.taskId);
    if (
      task.requiredBehavioralOutcome.length === 0 ||
      task.relevantImplementationFiles.length === 0 ||
      task.verifierFiles.length === 0 ||
      !task.verificationCommands.some((command) => command.required)
    ) {
      throw new Error(`Incomplete private ground truth: ${task.taskId}`);
    }
    for (const relativePath of [
      task.referencePatch,
      ...task.verifierFiles.map((file) => file.source),
    ]) {
      const target = path.resolve(privateDirectory, relativePath);
      if (!target.startsWith(path.resolve(privateDirectory) + path.sep)) {
        throw new Error(`Unsafe private artifact path: ${relativePath}`);
      }
      await access(target);
      if ((await stat(target)).size === 0)
        throw new Error(`Empty private artifact: ${relativePath}`);
    }
  }
  if (privateIds.size !== publicIds.size)
    throw new Error("Public/private task count mismatch");
};

export const installVerifierFiles = async (
  privateDirectory: string,
  workspace: string,
  task: PrivateTaskDefinition,
): Promise<string[]> => {
  const installed: string[] = [];
  for (const file of task.verifierFiles) {
    const source = path.resolve(privateDirectory, file.source);
    const destination = path.resolve(workspace, file.destination);
    if (!source.startsWith(path.resolve(privateDirectory) + path.sep))
      throw new Error("Unsafe verifier source");
    if (!destination.startsWith(path.resolve(workspace) + path.sep))
      throw new Error("Unsafe verifier destination");
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { errorOnExist: true, force: false });
    installed.push(destination);
  }
  return installed;
};

export const removeVerifierFiles = async (
  workspace: string,
  installedFiles: string[],
): Promise<void> => {
  for (const file of installedFiles) {
    if (!path.resolve(file).startsWith(path.resolve(workspace) + path.sep)) {
      throw new Error(`Refusing to remove unexpected verifier file: ${file}`);
    }
    await rm(file);
  }
};

export const executeVerificationCommands = async ({
  workspace,
  task,
  artifactDirectory,
}: {
  workspace: string;
  task: PrivateTaskDefinition;
  artifactDirectory: string;
}): Promise<TestResult[]> => {
  const results: TestResult[] = [];
  for (const [index, verification] of task.verificationCommands.entries()) {
    const processResult = await runProcess({
      command: verification.command,
      cwd: path.join(workspace, verification.cwd),
      timeoutMs: verification.timeoutMs,
    });
    const artifacts = await writeProcessArtifacts(
      processResult,
      artifactDirectory,
      `${String(index + 1).padStart(2, "0")}-${verification.label.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`,
    );
    results.push({
      label: verification.label,
      command: verification.command,
      cwd: verification.cwd,
      required: verification.required,
      passed: processResult.exitCode === 0 && !processResult.timedOut,
      exitCode: processResult.exitCode,
      durationMs: processResult.durationMs,
      ...artifacts,
    });
    if (
      verification.required &&
      (processResult.exitCode !== 0 || processResult.timedOut)
    )
      break;
  }
  return results;
};

export const gradeWorkspace = async ({
  workspace,
  taskId,
  artifactDirectory,
}: {
  workspace: string;
  taskId: string;
  artifactDirectory: string;
}): Promise<{
  task: PrivateTaskDefinition;
  testResults: TestResult[];
  passed: boolean;
}> => {
  const privateDirectory = await openPrivateArtifacts(
    `${taskId}-${crypto.randomUUID()}`,
  );
  let installed: string[] = [];
  try {
    const task = await loadPrivateTask(privateDirectory, taskId);
    installed = await installVerifierFiles(privateDirectory, workspace, task);
    const testResults = await executeVerificationCommands({
      workspace,
      task,
      artifactDirectory,
    });
    const passed =
      task.verificationCommands.length > 0 &&
      task.verificationCommands
        .filter((command) => command.required)
        .every(
          (command) =>
            testResults.find((result) => result.label === command.label)
              ?.passed === true,
        );
    return { task, testResults, passed };
  } finally {
    await removeVerifierFiles(workspace, installed);
    await closePrivateArtifacts(privateDirectory);
  }
};

export const applyReferencePatch = async (
  privateDirectory: string,
  workspace: string,
  task: PrivateTaskDefinition,
): Promise<void> => {
  const patchFile = path.resolve(privateDirectory, task.referencePatch);
  if (!patchFile.startsWith(path.resolve(privateDirectory) + path.sep))
    throw new Error("Unsafe reference patch");
  const result = await runProcess({
    command: ["git", "apply", "--whitespace=error-all", patchFile],
    cwd: workspace,
    timeoutMs: 60_000,
  });
  if (result.exitCode !== 0)
    throw new Error(
      `Reference patch failed for ${task.taskId}: ${result.stderr}`,
    );
};
