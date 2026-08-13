import { parseArgs } from "node:util";
import path from "node:path";
import { analyzeResults, loadResults, writeAnalysis } from "./analyze.ts";
import { RANDOMIZATION_SEED } from "./config.ts";
import { generatePairedRunOrder } from "./order.ts";
import { PRIVATE_BUNDLE_PATH } from "./paths.ts";
import {
  packPrivateDirectory,
  storeGraderKeyInMacOSKeychain,
} from "./private-bundle.ts";
import { freezeBenchmark } from "./freeze.ts";
import { RESULTS_ROOT, RUNTIME_ROOT } from "./paths.ts";
import { runPreflight } from "./preflight.ts";
import { validateReferenceSolutions } from "./reference-validation.ts";
import { executeRun } from "./run.ts";
import { shouldRetryRun } from "./retry.ts";
import { loadFreezeManifest, loadPublicTasks } from "./schema.ts";
import type { BenchmarkCondition, RunOrderEntry, TaskSet } from "./types.ts";
import { validateFreeze, validateTaskDefinitions } from "./validate.ts";
import { validatePrivateArtifacts } from "./verifier.ts";

const usage = (): never => {
  throw new Error(
    "Usage: benchmark:p17 <validate|dry-run|seal-private|store-grader-key|freeze|validate-references|run-pilots|run-final|run|analyze> [options]",
  );
};

const runEntry = async (
  entry: RunOrderEntry,
  set: TaskSet,
  retryNumber = 0,
): Promise<void> => {
  const result = await executeRun({
    taskId: entry.taskId,
    condition: entry.condition,
    runOrder: entry.runOrder,
    retryNumber,
    expectedSet: set,
  });
  console.log(
    JSON.stringify({
      event: "run-completed",
      taskId: entry.taskId,
      condition: entry.condition,
      runOrder: entry.runOrder,
      retryNumber,
      completionStatus: result.completionStatus,
      verifierPassed: result.verifierPassed,
      durationMs: result.durationMs,
    }),
  );
  if (shouldRetryRun(result, retryNumber)) {
    console.log(
      JSON.stringify({
        event: "infrastructure-retry",
        taskId: entry.taskId,
        condition: entry.condition,
        priorRetryNumber: retryNumber,
        reason: result.infrastructureFailure?.detail,
      }),
    );
    await runEntry(entry, set, retryNumber + 1);
  }
};

const runOrder = async (
  entries: RunOrderEntry[],
  set: TaskSet,
): Promise<void> => {
  for (const entry of entries) {
    console.log(
      JSON.stringify({
        event: "run-starting",
        set,
        taskId: entry.taskId,
        condition: entry.condition,
        runOrder: entry.runOrder,
      }),
    );
    await runEntry(entry, set);
  }
};

const main = async (): Promise<void> => {
  const command = process.argv[2] ?? usage();
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      "private-source": { type: "string" },
      task: { type: "string" },
      condition: { type: "string" },
      set: { type: "string" },
      "run-order": { type: "string" },
      "confirm-final": { type: "boolean", default: false },
      input: { type: "string" },
      output: { type: "string" },
    },
    strict: true,
  });
  switch (command) {
    case "validate":
      await validateFreeze();
      console.log("P17 benchmark freeze is valid.");
      return;
    case "dry-run": {
      await validateFreeze();
      const checks = await runPreflight();
      console.log(JSON.stringify({ ok: true, checks }, null, 2));
      return;
    }
    case "freeze": {
      await validateTaskDefinitions();
      const privateSource = values["private-source"];
      if (!privateSource) throw new Error("freeze requires --private-source");
      const resolvedPrivateSource = path.resolve(privateSource);
      await validatePrivateArtifacts(resolvedPrivateSource);
      const manifest = await freezeBenchmark(resolvedPrivateSource);
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }
    case "seal-private": {
      await validateTaskDefinitions();
      const privateSource = values["private-source"];
      if (!privateSource)
        throw new Error("seal-private requires --private-source");
      const resolvedPrivateSource = path.resolve(privateSource);
      await validatePrivateArtifacts(resolvedPrivateSource);
      const hashes = await packPrivateDirectory(
        resolvedPrivateSource,
        PRIVATE_BUNDLE_PATH,
      );
      console.log(
        JSON.stringify({ sealed: true, fileCount: hashes.length }, null, 2),
      );
      return;
    }
    case "store-grader-key":
      await storeGraderKeyInMacOSKeychain();
      console.log(
        "Stored the P17 grader key in the current user's macOS Keychain.",
      );
      return;
    case "validate-references": {
      const records = await validateReferenceSolutions(values.task);
      console.log(JSON.stringify(records, null, 2));
      return;
    }
    case "run-pilots": {
      await validateTaskDefinitions();
      await runPreflight({ validateSourceManifest: false });
      const pilotTaskIds = (await loadPublicTasks())
        .filter((task) => task.set === "pilot")
        .map((task) => task.id);
      await runOrder(
        generatePairedRunOrder(pilotTaskIds, `${RANDOMIZATION_SEED}:pilot`),
        "pilot",
      );
      return;
    }
    case "run-final": {
      if (!values["confirm-final"])
        throw new Error("run-final requires --confirm-final");
      await validateFreeze();
      await runPreflight();
      const manifest = await loadFreezeManifest();
      await runOrder(manifest.randomization.finalRunOrder, "final");
      return;
    }
    case "run": {
      const taskId = values.task;
      const condition = values.condition;
      const set = values.set;
      const numericRunOrder = Number(values["run-order"] ?? "0");
      if (
        !taskId ||
        (condition !== "A" && condition !== "B") ||
        (set !== "pilot" && set !== "final")
      ) {
        throw new Error(
          "run requires --task, --condition A|B, and --set pilot|final",
        );
      }
      if (set === "final") await validateFreeze();
      await runEntry(
        {
          taskId,
          condition: condition as BenchmarkCondition,
          runOrder: numericRunOrder,
          pairPosition: 1,
        },
        set,
      );
      return;
    }
    case "analyze": {
      await validateFreeze();
      const input = path.resolve(
        values.input ?? path.join(RESULTS_ROOT, "final"),
      );
      const output = path.resolve(
        values.output ?? path.join(RUNTIME_ROOT, "analysis.json"),
      );
      const analysis = analyzeResults(
        await loadResults(input),
        await loadPublicTasks(),
      );
      await writeAnalysis(analysis, output);
      console.log(JSON.stringify(analysis, null, 2));
      return;
    }
    default:
      usage();
  }
};

await main();
