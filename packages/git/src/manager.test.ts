import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GitCliRepositoryManager } from "./manager";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("GitCliRepositoryManager", () => {
  test("clones, updates, inspects, reads, checks out, and follows file history", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "swega-git-test-"));
    temporaryDirectories.push(fixtureRoot);
    const source = join(fixtureRoot, "source");
    const managedRoot = join(fixtureRoot, "managed");
    const repositoryId = "123e4567-e89b-42d3-a456-426614174000";

    await mkdir(join(source, "src"), { recursive: true });
    await runGit(source, ["init", "--initial-branch=main"]);
    await writeFile(
      join(source, "src", "index.ts"),
      "export const version = 1;\n",
    );
    await writeFile(join(source, "README.md"), "# Fixture\n");
    await runGit(source, ["add", "."]);
    await commit(source, "initial commit");

    await mkdir(`${join(managedRoot, repositoryId)}.clone.tmp`, {
      recursive: true,
    });
    const manager = new GitCliRepositoryManager({
      rootDirectory: managedRoot,
      allowLocalRepositories: true,
    });
    const repository = await manager.cloneRepository({
      repositoryId,
      remoteUrl: source,
    });
    const clonedAgain = await manager.cloneRepository({
      repositoryId,
      remoteUrl: source,
    });

    expect(clonedAgain.directory).toBe(repository.directory);

    const firstFiles = await manager.listFiles(
      repository,
      "refs/remotes/origin/main",
    );
    expect(firstFiles.map((file) => file.path)).toEqual([
      "README.md",
      "src/index.ts",
    ]);
    expect(
      firstFiles.find((file) => file.path === "src/index.ts"),
    ).toMatchObject({
      extension: "ts",
      language: "TypeScript",
      size: 26,
    });

    const contents = await manager.readFile(repository, "src/index.ts", {
      revision: "refs/remotes/origin/main",
    });
    expect(new TextDecoder().decode(contents)).toBe(
      "export const version = 1;\n",
    );

    await writeFile(
      join(source, "src", "index.ts"),
      "export const version = 2;\n",
    );
    await writeFile(join(source, "src", "worker.py"), "print('worker')\n");
    const largeText = "SWEGA runtime byte boundary.\n".repeat(17_000);
    await writeFile(join(source, "src", "large.txt"), largeText);
    await runGit(source, ["add", "."]);
    await commit(source, "update source files");
    await manager.updateRepository(repository);

    const history = await manager.getCommitHistory(repository, {
      revision: "refs/remotes/origin/main",
      limit: 10,
    });
    expect(history.map((entry) => entry.subject)).toEqual([
      "update source files",
      "initial commit",
    ]);
    expect(history.every((entry) => !entry.body.includes("\0"))).toBe(true);
    const latestCommit = history[0];
    const initialCommit = history[1];
    if (!latestCommit || !initialCommit) {
      throw new Error("Expected two fixture commits");
    }

    const fileHistory = await manager.getFileHistory(
      repository,
      "src/index.ts",
      {
        revision: "refs/remotes/origin/main",
        limit: 10,
      },
    );
    expect(fileHistory).toHaveLength(2);

    const files = await manager.listFiles(
      repository,
      "refs/remotes/origin/main",
    );
    expect(files.find((file) => file.path === "src/worker.py")).toMatchObject({
      extension: "py",
      language: "Python",
    });
    const largeContents = await manager.readFile(repository, "src/large.txt", {
      revision: "refs/remotes/origin/main",
    });
    expect(largeContents).toBeInstanceOf(Uint8Array);
    expect(largeContents.includes(0)).toBe(false);
    expect(new TextDecoder().decode(largeContents)).toBe(largeText);
    expect(new Set(files.map((file) => file.lastKnownCommitSha))).toEqual(
      new Set([latestCommit.hash]),
    );

    const checkedOutSha = await manager.checkoutRevision(
      repository,
      initialCommit.hash,
    );
    expect(checkedOutSha).toBe(initialCommit.hash);
  });
});

async function runGit(
  cwd: string,
  arguments_: readonly string[],
): Promise<void> {
  const subprocess = Bun.spawn(["git", ...arguments_], {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Fixture Git command failed: ${stderr}`);
  }
}

async function commit(cwd: string, message: string): Promise<void> {
  await runGit(cwd, [
    "-c",
    "user.name=SWEGA Test",
    "-c",
    "user.email=swega@example.test",
    "commit",
    "-m",
    message,
  ]);
}
