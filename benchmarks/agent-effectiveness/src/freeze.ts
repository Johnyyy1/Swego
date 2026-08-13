import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BENCHMARK_VERSION,
  conditionConfiguration,
  conditionConfigurationHash,
  RANDOMIZATION_SEED,
  REPOSITORY_ID,
  SOLVER_CONFIGURATION,
  SOURCE_REVISION,
} from "./config.ts";
import {
  listFilesRecursively,
  sha256,
  sha256File,
  stableJson,
} from "./hash.ts";
import { generatePairedRunOrder } from "./order.ts";
import {
  BENCHMARK_ROOT,
  FREEZE_DIGEST_PATH,
  FREEZE_MANIFEST_PATH,
  PRIVATE_BUNDLE_PATH,
  SWEGA_ROOT,
} from "./paths.ts";
import {
  hashPrivateDirectory,
  packPrivateDirectory,
  unpackPrivateBundle,
} from "./private-bundle.ts";
import { runProcess } from "./process.ts";
import { loadPublicTasks } from "./schema.ts";
import type { ArtifactHash, BenchmarkFreezeManifest } from "./types.ts";
import { prepareBaseWorkspace, sourceArchiveHash } from "./workspace.ts";

const hashArtifacts = async (
  relativePaths: string[],
): Promise<ArtifactHash[]> =>
  Promise.all(
    relativePaths.sort().map(async (relativePath) => ({
      path: path.relative(SWEGA_ROOT, path.join(BENCHMARK_ROOT, relativePath)),
      sha256: await sha256File(path.join(BENCHMARK_ROOT, relativePath)),
    })),
  );

export const freezeBenchmark = async (
  privateSourceDirectory: string,
): Promise<BenchmarkFreezeManifest> => {
  await prepareBaseWorkspace();
  const tasks = await loadPublicTasks();
  const conditionDirectory = path.join(BENCHMARK_ROOT, "conditions");
  await mkdir(conditionDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(conditionDirectory, "A.json"),
      stableJson(conditionConfiguration("A")),
      { flag: "wx" },
    ),
    writeFile(
      path.join(conditionDirectory, "B.json"),
      stableJson(conditionConfiguration("B")),
      { flag: "wx" },
    ),
  ]);
  let privateArtifactHashes: ArtifactHash[];
  try {
    await access(PRIVATE_BUNDLE_PATH);
    const unpacked = await mkdtemp(
      path.join(os.tmpdir(), "p17-private-verify-"),
    );
    try {
      await unpackPrivateBundle(PRIVATE_BUNDLE_PATH, unpacked);
      const [sourceHashes, bundleHashes] = await Promise.all([
        hashPrivateDirectory(privateSourceDirectory),
        hashPrivateDirectory(unpacked),
      ]);
      if (JSON.stringify(sourceHashes) !== JSON.stringify(bundleHashes)) {
        throw new Error(
          "Existing private bundle does not match the private source directory",
        );
      }
      privateArtifactHashes = sourceHashes;
    } finally {
      await rm(unpacked, { recursive: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    privateArtifactHashes = await packPrivateDirectory(
      privateSourceDirectory,
      PRIVATE_BUNDLE_PATH,
    );
  }
  const publicFiles = (await listFilesRecursively(BENCHMARK_ROOT)).filter(
    (file) =>
      ![
        "manifest.freeze.json",
        "manifest.freeze.sha256",
        "private.bundle.enc.json",
      ].includes(file) && !file.startsWith("tests/fixtures/generated/"),
  );
  const publicArtifactHashes = await hashArtifacts(publicFiles);
  const isolatedBaseCommit = (
    await runProcess({
      command: ["git", "rev-parse", "HEAD"],
      cwd: path.join(SWEGA_ROOT, ".swega/p17-agent-benchmark/base"),
      timeoutMs: 30_000,
    })
  ).stdout.trim();
  const isolatedBaseTree = (
    await runProcess({
      command: ["git", "rev-parse", "HEAD^{tree}"],
      cwd: path.join(SWEGA_ROOT, ".swega/p17-agent-benchmark/base"),
      timeoutMs: 30_000,
    })
  ).stdout.trim();
  const trackedFileCount = Number(
    (
      await runProcess({
        command: ["git", "ls-files"],
        cwd: path.join(SWEGA_ROOT, ".swega/p17-agent-benchmark/base"),
        timeoutMs: 30_000,
      })
    ).stdout
      .trim()
      .split("\n").length,
  );
  const finalTaskIds = tasks
    .filter((task) => task.set === "final")
    .map((task) => task.id);
  const pilotTaskIds = tasks
    .filter((task) => task.set === "pilot")
    .map((task) => task.id);
  const manifest: BenchmarkFreezeManifest = {
    schemaVersion: 1,
    benchmarkVersion: BENCHMARK_VERSION,
    frozenAt: new Date().toISOString(),
    researchQuestion:
      "Does giving the same Codex coding agent access to SWEGA MCP improve performance on realistic software-engineering tasks?",
    solver: SOLVER_CONFIGURATION,
    source: {
      repository: "formbricks/formbricks",
      repositoryId: REPOSITORY_ID,
      sourceRevision: SOURCE_REVISION,
      sourceArchiveSha256: await sourceArchiveHash(),
      isolatedBaseCommit,
      isolatedBaseTree,
      trackedFileCount,
      packageManager: "pnpm@11.19.0 (pinned repository declares pnpm@11.7.0)",
      installCommand: [
        "pnpm",
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
      ],
    },
    swega: {
      runtimeCommit: "8814209",
      freezeDocumentationCommit: "8501f34",
      chunks: 23_430,
      compatibleEmbeddings: 23_430,
      relationships: 14_815,
      embeddingProvider: "ollama",
      embeddingModel: "qwen3-embedding:0.6b",
      embeddingDimensions: 512,
      postgresVersion: "17.10",
      pgvectorVersion: "0.8.6",
      contextBudgetCharacters: 30_000,
      reranker: "disabled",
      mcpTransport: "local-stdio",
      mcpTools: [
        "swega_list_repositories",
        "swega_get_repository",
        "swega_get_context",
      ],
    },
    randomization: {
      algorithm: "sha256-sort-and-pair-parity-v1",
      seed: RANDOMIZATION_SEED,
      finalRunOrder: generatePairedRunOrder(finalTaskIds, RANDOMIZATION_SEED),
      pilotRunOrder: generatePairedRunOrder(
        pilotTaskIds,
        `${RANDOMIZATION_SEED}:pilot`,
      ),
    },
    finalTaskIds,
    pilotTaskIds,
    conditionConfigurationHashes: {
      A: conditionConfigurationHash("A"),
      B: conditionConfigurationHash("B"),
    },
    privateBundleSha256: await sha256File(PRIVATE_BUNDLE_PATH),
    privateArtifactHashes,
    publicArtifactHashes,
  };
  const serialized = stableJson(manifest);
  await writeFile(FREEZE_MANIFEST_PATH, serialized, { flag: "wx" });
  await writeFile(
    FREEZE_DIGEST_PATH,
    `${sha256(serialized)}  ${path.basename(FREEZE_MANIFEST_PATH)}\n`,
    { flag: "wx" },
  );
  return manifest;
};
