import { sha256 } from "./hash.ts";
import type { BenchmarkCondition, RunOrderEntry } from "./types.ts";

export const generatePairedRunOrder = (
  taskIds: string[],
  seed: string,
): RunOrderEntry[] => {
  const orderedTasks = [...taskIds].sort((left, right) =>
    sha256(`${seed}:task:${left}`).localeCompare(
      sha256(`${seed}:task:${right}`),
    ),
  );
  const entries: RunOrderEntry[] = [];
  for (const taskId of orderedTasks) {
    const first: BenchmarkCondition =
      Number.parseInt(sha256(`${seed}:condition:${taskId}`).slice(0, 2), 16) % 2
        ? "A"
        : "B";
    const second: BenchmarkCondition = first === "A" ? "B" : "A";
    entries.push(
      {
        runOrder: entries.length + 1,
        taskId,
        condition: first,
        pairPosition: 1,
      },
      {
        runOrder: entries.length + 2,
        taskId,
        condition: second,
        pairPosition: 2,
      },
    );
  }
  return entries;
};
