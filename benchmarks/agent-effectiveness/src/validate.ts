import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { conditionConfigurationHash, RANDOMIZATION_SEED } from "./config.ts";
import { sha256, sha256File } from "./hash.ts";
import { generatePairedRunOrder } from "./order.ts";
import {
  FREEZE_DIGEST_PATH,
  FREEZE_MANIFEST_PATH,
  PRIVATE_BUNDLE_PATH,
  TASKS_ROOT,
  SWEGA_ROOT,
} from "./paths.ts";
import { loadFreezeManifest, loadPublicTasks } from "./schema.ts";

export const validateTaskDefinitions = async (): Promise<void> => {
  const tasks = await loadPublicTasks();
  for (const task of tasks) {
    const promptPath = path.join(TASKS_ROOT, task.promptFile);
    const prompt = await readFile(promptPath, "utf8");
    if (sha256(prompt) !== task.promptSha256)
      throw new Error(`Prompt hash mismatch: ${task.id}`);
    if (!prompt.endsWith("\n") || prompt.endsWith("\n\n")) {
      throw new Error(`Prompt must end with exactly one newline: ${task.id}`);
    }
  }
};

export const validateFreeze = async (): Promise<void> => {
  await validateTaskDefinitions();
  const manifest = await loadFreezeManifest();
  const manifestBytes = await readFile(FREEZE_MANIFEST_PATH);
  const recordedDigest = (await readFile(FREEZE_DIGEST_PATH, "utf8"))
    .trim()
    .split(/\s+/)[0];
  if (sha256(manifestBytes) !== recordedDigest)
    throw new Error("Freeze manifest digest mismatch");
  if (
    (await sha256File(PRIVATE_BUNDLE_PATH)) !== manifest.privateBundleSha256
  ) {
    throw new Error("Private bundle hash mismatch");
  }
  if (
    conditionConfigurationHash("A") !== manifest.conditionConfigurationHashes.A
  ) {
    throw new Error("Condition A configuration drift");
  }
  if (
    conditionConfigurationHash("B") !== manifest.conditionConfigurationHashes.B
  ) {
    throw new Error("Condition B configuration drift");
  }
  const expectedFinal = generatePairedRunOrder(
    manifest.finalTaskIds,
    RANDOMIZATION_SEED,
  );
  const expectedPilot = generatePairedRunOrder(
    manifest.pilotTaskIds,
    `${RANDOMIZATION_SEED}:pilot`,
  );
  if (!isDeepStrictEqual(expectedFinal, manifest.randomization.finalRunOrder)) {
    throw new Error("Final run order drift");
  }
  if (!isDeepStrictEqual(expectedPilot, manifest.randomization.pilotRunOrder)) {
    throw new Error("Pilot run order drift");
  }
  for (const artifact of manifest.publicArtifactHashes) {
    const artifactPath = path.join(SWEGA_ROOT, artifact.path);
    await access(artifactPath);
    if ((await sha256File(artifactPath)) !== artifact.sha256)
      throw new Error(`Frozen artifact drift: ${artifact.path}`);
  }
};
