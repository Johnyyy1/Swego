import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { SOURCE_REVISION } from "./config.ts";
import { sha256File } from "./hash.ts";
import {
  BASE_WORKSPACE,
  RUNTIME_ROOT,
  RUN_WORKSPACES_ROOT,
  SWEGA_ROOT,
} from "./paths.ts";
import { runProcess } from "./process.ts";

const MANAGED_SOURCE = path.join(
  SWEGA_ROOT,
  ".swega",
  "repositories",
  "a61b0198-8307-41b0-9b51-9c510793cefa",
);
const ARCHIVE_PATH = path.join(RUNTIME_ROOT, "formbricks-pinned.tar");
const EXPECTED_BASE_COMMIT = "189c3bd35609aaa83ea30958779baf487345c3be";

const assertSuccess = (
  label: string,
  result: Awaited<ReturnType<typeof runProcess>>,
): void => {
  if (result.exitCode !== 0)
    throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
};

const exists = async (target: string): Promise<boolean> => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

const copyWorkspace = async (
  source: string,
  destination: string,
): Promise<void> => {
  const copied = await runProcess({
    command: ["cp", "-cR", source, destination],
    cwd: RUNTIME_ROOT,
    timeoutMs: 300_000,
  });
  assertSuccess("copy-on-write workspace creation", copied);
};

export const prepareBaseWorkspace = async (): Promise<void> => {
  if (await exists(path.join(BASE_WORKSPACE, ".git"))) {
    await verifyBaseWorkspace();
    return;
  }
  await mkdir(RUNTIME_ROOT, { recursive: true });
  if (await exists(BASE_WORKSPACE))
    await rm(BASE_WORKSPACE, { recursive: true });
  await mkdir(BASE_WORKSPACE, { recursive: true });
  const archive = await runProcess({
    command: [
      "git",
      "archive",
      "--format=tar",
      `--output=${ARCHIVE_PATH}`,
      SOURCE_REVISION,
    ],
    cwd: MANAGED_SOURCE,
    timeoutMs: 120_000,
  });
  assertSuccess("git archive", archive);
  const extract = await runProcess({
    command: ["tar", "-xf", ARCHIVE_PATH, "-C", BASE_WORKSPACE],
    cwd: RUNTIME_ROOT,
    timeoutMs: 120_000,
  });
  assertSuccess("source extraction", extract);
  const install = await runProcess({
    command: ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"],
    cwd: BASE_WORKSPACE,
    timeoutMs: 1_200_000,
  });
  assertSuccess("dependency installation", install);
  assertSuccess(
    "git init",
    await runProcess({
      command: ["git", "init", "-b", "main"],
      cwd: BASE_WORKSPACE,
      timeoutMs: 30_000,
    }),
  );
  assertSuccess(
    "git config name",
    await runProcess({
      command: ["git", "config", "user.name", "SWEGA Benchmark"],
      cwd: BASE_WORKSPACE,
      timeoutMs: 30_000,
    }),
  );
  assertSuccess(
    "git config email",
    await runProcess({
      command: ["git", "config", "user.email", "benchmark@swega.invalid"],
      cwd: BASE_WORKSPACE,
      timeoutMs: 30_000,
    }),
  );
  assertSuccess(
    "git add",
    await runProcess({
      command: ["git", "add", "-A"],
      cwd: BASE_WORKSPACE,
      timeoutMs: 120_000,
    }),
  );
  const commitEnvironment = {
    ...process.env,
    GIT_AUTHOR_DATE: "2026-08-13T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-08-13T00:00:00Z",
  };
  assertSuccess(
    "baseline commit",
    await runProcess({
      command: [
        "git",
        "commit",
        "-m",
        "chore: initialize isolated benchmark snapshot",
      ],
      cwd: BASE_WORKSPACE,
      timeoutMs: 180_000,
      env: commitEnvironment,
    }),
  );
  await verifyBaseWorkspace();
};

const gitOutput = async (
  workspace: string,
  args: string[],
): Promise<string> => {
  const result = await runProcess({
    command: ["git", ...args],
    cwd: workspace,
    timeoutMs: 30_000,
  });
  assertSuccess(`git ${args.join(" ")}`, result);
  return result.stdout.trim();
};

export const verifyBaseWorkspace = async (): Promise<void> => {
  const [head, commits, remotes, status] = await Promise.all([
    gitOutput(BASE_WORKSPACE, ["rev-parse", "HEAD"]),
    gitOutput(BASE_WORKSPACE, ["rev-list", "--all", "--count"]),
    gitOutput(BASE_WORKSPACE, ["remote"]),
    gitOutput(BASE_WORKSPACE, ["status", "--porcelain"]),
  ]);
  if (head !== EXPECTED_BASE_COMMIT)
    throw new Error(`Unexpected isolated base commit: ${head}`);
  if (commits !== "1")
    throw new Error(`Isolated base exposes ${commits} Git commits`);
  if (remotes !== "")
    throw new Error("Isolated base must not contain Git remotes");
  if (status !== "") throw new Error("Isolated base worktree is not clean");
  const modules = path.join(BASE_WORKSPACE, "node_modules", ".modules.yaml");
  if (!(await exists(modules)) || !(await stat(modules)).isFile())
    throw new Error("Frozen dependencies missing");
};

export const sourceArchiveHash = async (): Promise<string> => {
  if (!(await exists(ARCHIVE_PATH))) {
    await mkdir(RUNTIME_ROOT, { recursive: true });
    const archive = await runProcess({
      command: [
        "git",
        "archive",
        "--format=tar",
        `--output=${ARCHIVE_PATH}`,
        SOURCE_REVISION,
      ],
      cwd: MANAGED_SOURCE,
      timeoutMs: 120_000,
    });
    assertSuccess("git archive", archive);
  }
  return sha256File(ARCHIVE_PATH);
};

export const dependencyState = async (): Promise<{
  modulesYamlSha256: string;
  packageManager: string;
}> => ({
  modulesYamlSha256: await sha256File(
    path.join(BASE_WORKSPACE, "node_modules", ".modules.yaml"),
  ),
  packageManager: (
    await readFile(path.join(BASE_WORKSPACE, "package.json"), "utf8")
  ).includes('"pnpm@11.7.0"')
    ? "pnpm@11.19.0 (project declares pnpm@11.7.0)"
    : "pnpm@11.19.0",
});

export const createRunWorkspace = async (
  taskId: string,
  condition: "A" | "B",
  retryNumber: number,
): Promise<string> => {
  await prepareBaseWorkspace();
  const destination = path.join(
    RUN_WORKSPACES_ROOT,
    taskId,
    condition,
    `attempt-${String(retryNumber)}`,
  );
  if (await exists(destination))
    throw new Error(`Run workspace already exists: ${destination}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyWorkspace(BASE_WORKSPACE, destination);
  const [head, commits, remotes, status] = await Promise.all([
    gitOutput(destination, ["rev-parse", "HEAD"]),
    gitOutput(destination, ["rev-list", "--all", "--count"]),
    gitOutput(destination, ["remote"]),
    gitOutput(destination, ["status", "--porcelain"]),
  ]);
  if (head !== EXPECTED_BASE_COMMIT || commits !== "1" || remotes || status) {
    throw new Error(
      "Created workspace failed source/Git-history isolation checks",
    );
  }
  return destination;
};

export const copyBaseForValidation = async (name: string): Promise<string> => {
  await prepareBaseWorkspace();
  const destination = path.join(RUNTIME_ROOT, "validation", name);
  if (await exists(destination)) await rm(destination, { recursive: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await copyWorkspace(BASE_WORKSPACE, destination);
  return destination;
};
