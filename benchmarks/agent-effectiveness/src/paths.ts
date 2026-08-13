import path from "node:path";

export const BENCHMARK_ROOT = path.resolve(import.meta.dir, "..");
export const SWEGA_ROOT = path.resolve(BENCHMARK_ROOT, "../..");
export const TASKS_ROOT = path.join(BENCHMARK_ROOT, "tasks");
export const FREEZE_MANIFEST_PATH = path.join(
  BENCHMARK_ROOT,
  "manifest.freeze.json",
);
export const FREEZE_DIGEST_PATH = path.join(
  BENCHMARK_ROOT,
  "manifest.freeze.sha256",
);
export const PRIVATE_BUNDLE_PATH = path.join(
  BENCHMARK_ROOT,
  "private.bundle.enc.json",
);
export const RUNTIME_ROOT = path.join(
  SWEGA_ROOT,
  ".swega",
  "p17-agent-benchmark",
);
export const BASE_WORKSPACE = path.join(RUNTIME_ROOT, "base");
export const RUN_WORKSPACES_ROOT = path.join(RUNTIME_ROOT, "workspaces");
export const RESULTS_ROOT = path.join(RUNTIME_ROOT, "results");
