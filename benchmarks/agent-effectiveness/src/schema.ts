import { readFile } from "node:fs/promises";
import path from "node:path";
import { FREEZE_MANIFEST_PATH, TASKS_ROOT } from "./paths.ts";
import {
  CONDITIONS,
  DIFFICULTIES,
  TASK_SETS,
  type BenchmarkFreezeManifest,
  type PublicTaskDefinition,
  type RunResult,
} from "./types.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJson = async (filePath: string): Promise<unknown> =>
  JSON.parse(await readFile(filePath, "utf8"));

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${field} must be a non-empty string`);
  return value;
};

export const parsePublicTask = (value: unknown): PublicTaskDefinition => {
  if (!isRecord(value)) throw new Error("Task definition must be an object");
  const id = requireString(value.id, "task.id");
  const set = requireString(value.set, `${id}.set`);
  const difficulty = requireString(value.difficulty, `${id}.difficulty`);
  if (!TASK_SETS.includes(set as (typeof TASK_SETS)[number]))
    throw new Error(`${id}.set is invalid`);
  if (!DIFFICULTIES.includes(difficulty as (typeof DIFFICULTIES)[number])) {
    throw new Error(`${id}.difficulty is invalid`);
  }
  return {
    id,
    set: set as PublicTaskDefinition["set"],
    category: requireString(value.category, `${id}.category`),
    difficulty: difficulty as PublicTaskDefinition["difficulty"],
    promptFile: requireString(value.promptFile, `${id}.promptFile`),
    promptSha256: requireString(value.promptSha256, `${id}.promptSha256`),
  };
};

export const loadPublicTasks = async (): Promise<PublicTaskDefinition[]> => {
  const parsed = await readJson(path.join(TASKS_ROOT, "tasks.json"));
  if (!Array.isArray(parsed)) throw new Error("tasks.json must be an array");
  const tasks = parsed.map(parsePublicTask);
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    ids.add(task.id);
  }
  const finalCount = tasks.filter((task) => task.set === "final").length;
  const pilotCount = tasks.filter((task) => task.set === "pilot").length;
  if (finalCount !== 12)
    throw new Error(`Expected 12 final tasks, found ${String(finalCount)}`);
  if (pilotCount < 2 || pilotCount > 3)
    throw new Error(`Expected 2-3 pilot tasks, found ${String(pilotCount)}`);
  return tasks;
};

export const loadFreezeManifest =
  async (): Promise<BenchmarkFreezeManifest> => {
    const value = await readJson(FREEZE_MANIFEST_PATH);
    if (!isRecord(value) || value.schemaVersion !== 1)
      throw new Error("Invalid freeze manifest schema");
    return value as unknown as BenchmarkFreezeManifest;
  };

export const parseRunResult = (value: unknown): RunResult => {
  if (!isRecord(value) || value.schemaVersion !== 1)
    throw new Error("Invalid run-result schema");
  for (const field of [
    "benchmarkVersion",
    "taskId",
    "model",
    "effort",
    "codexVersion",
    "sourceRevision",
    "startedAt",
    "transcriptArtifact",
    "patchArtifact",
    "stderrArtifact",
    "finalMessageArtifact",
  ]) {
    requireString(value[field], `result.${field}`);
  }
  if (!CONDITIONS.includes(value.condition as (typeof CONDITIONS)[number])) {
    throw new Error("result.condition is invalid");
  }
  if (!TASK_SETS.includes(value.taskSet as (typeof TASK_SETS)[number])) {
    throw new Error("result.taskSet is invalid");
  }
  if (
    ![
      "completed",
      "timed_out",
      "codex_error",
      "infrastructure_failure",
    ].includes(String(value.completionStatus))
  ) {
    throw new Error("result.completionStatus is invalid");
  }
  for (const field of ["runOrder", "durationMs", "retryNumber"]) {
    if (!Number.isInteger(value[field]) || (value[field] as number) < 0) {
      throw new Error(`result.${field} must be a non-negative integer`);
    }
  }
  if (typeof value.verifierPassed !== "boolean")
    throw new Error("result.verifierPassed must be boolean");
  if (
    !Array.isArray(value.filesModified) ||
    !Array.isArray(value.testResults) ||
    !Array.isArray(value.unavailableMetrics)
  ) {
    throw new Error("result file/test arrays are invalid");
  }
  for (const field of [
    "patchStats",
    "toolMetrics",
    "relevantFileMetrics",
    "usageMetrics",
    "swegaMetrics",
  ]) {
    if (!isRecord(value[field]))
      throw new Error(`result.${field} must be an object`);
  }
  if (
    value.infrastructureFailure !== null &&
    !isRecord(value.infrastructureFailure)
  ) {
    throw new Error("result.infrastructureFailure must be an object or null");
  }
  return value as unknown as RunResult;
};
