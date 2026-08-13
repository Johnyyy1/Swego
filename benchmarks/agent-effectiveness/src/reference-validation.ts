import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./paths.ts";
import { loadPublicTasks } from "./schema.ts";
import {
  applyReferencePatch,
  closePrivateArtifacts,
  executeVerificationCommands,
  installVerifierFiles,
  loadPrivateTask,
  openPrivateArtifacts,
  removeVerifierFiles,
  validatePrivateArtifacts,
} from "./verifier.ts";
import { copyBaseForValidation } from "./workspace.ts";

export interface ReferenceValidationRecord {
  taskId: string;
  baselineRejected: boolean;
  referenceAccepted: boolean;
  requiredChecks: string[];
}

const referenceValidationRoot = path.join(RUNTIME_ROOT, "reference-validation");

const verifyOne = async (
  taskId: string,
  privateDirectory: string,
  baselineWorkspace: string,
): Promise<ReferenceValidationRecord> => {
  const task = await loadPrivateTask(privateDirectory, taskId);
  const baselineArtifacts = path.join(
    referenceValidationRoot,
    taskId,
    "baseline",
  );
  const baselineFiles = await installVerifierFiles(
    privateDirectory,
    baselineWorkspace,
    task,
  );
  const baselineResults = await executeVerificationCommands({
    workspace: baselineWorkspace,
    task,
    artifactDirectory: baselineArtifacts,
  }).finally(async () => removeVerifierFiles(baselineWorkspace, baselineFiles));
  const baselineRejected = baselineResults.some(
    (result) => result.required && !result.passed,
  );
  const referenceWorkspace = await copyBaseForValidation(`${taskId}-reference`);
  await applyReferencePatch(privateDirectory, referenceWorkspace, task);
  const referenceArtifacts = path.join(
    referenceValidationRoot,
    taskId,
    "reference",
  );
  const referenceFiles = await installVerifierFiles(
    privateDirectory,
    referenceWorkspace,
    task,
  );
  const referenceResults = await executeVerificationCommands({
    workspace: referenceWorkspace,
    task,
    artifactDirectory: referenceArtifacts,
  }).finally(async () =>
    removeVerifierFiles(referenceWorkspace, referenceFiles),
  );
  const referenceAccepted =
    referenceResults.length === task.verificationCommands.length &&
    referenceResults
      .filter((result) => result.required)
      .every((result) => result.passed);
  return {
    taskId,
    baselineRejected,
    referenceAccepted,
    requiredChecks: task.verificationCommands
      .filter((command) => command.required)
      .map((command) => command.label),
  };
};

export const validateReferenceSolutions = async (
  taskId?: string,
): Promise<ReferenceValidationRecord[]> => {
  await rm(
    taskId
      ? path.join(referenceValidationRoot, taskId)
      : referenceValidationRoot,
    { recursive: true, force: true },
  );
  const publicTasks = await loadPublicTasks();
  const tasks = taskId
    ? publicTasks.filter((task) => task.id === taskId)
    : publicTasks;
  if (tasks.length === 0)
    throw new Error(`Unknown task for reference validation: ${taskId}`);
  const baselineWorkspace = await copyBaseForValidation("all-task-baselines");
  const privateDirectory = await openPrivateArtifacts(
    `reference-validation-${crypto.randomUUID()}`,
  );
  try {
    await validatePrivateArtifacts(privateDirectory);
    const records: ReferenceValidationRecord[] = [];
    for (const task of tasks)
      records.push(
        await verifyOne(task.id, privateDirectory, baselineWorkspace),
      );
    const failed = records.filter(
      (record) => !record.baselineRejected || !record.referenceAccepted,
    );
    await mkdir(referenceValidationRoot, { recursive: true });
    await writeFile(
      path.join(
        referenceValidationRoot,
        taskId ? `summary.${taskId}.json` : "summary.json",
      ),
      `${JSON.stringify(records, null, 2)}\n`,
    );
    if (failed.length > 0)
      throw new Error(
        `Reference validation failed: ${failed.map((entry) => entry.taskId).join(", ")}`,
      );
    return records;
  } finally {
    await closePrivateArtifacts(privateDirectory);
  }
};
