import { afterAll, describe, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runProcess } from "../src/process.ts";
import { RUNTIME_ROOT } from "../src/paths.ts";
import { loadPublicTasks } from "../src/schema.ts";
import { validateTaskDefinitions } from "../src/validate.ts";
import { copyBaseForValidation } from "../src/workspace.ts";

const copies: string[] = [];

afterAll(async () => {
  for (const directory of copies) await rm(directory, { recursive: true });
}, 180_000);

describe("task and workspace isolation", () => {
  test("loads exactly twelve final and two pilot tasks with valid prompt hashes", async () => {
    await validateTaskDefinitions();
    const tasks = await loadPublicTasks();
    expect(tasks.filter((task) => task.set === "final")).toHaveLength(12);
    expect(tasks.filter((task) => task.set === "pilot")).toHaveLength(2);
  });

  test("creates independent one-commit workspaces without remotes or future history", async () => {
    const A = await copyBaseForValidation("unit-isolation-A");
    const B = await copyBaseForValidation("unit-isolation-B");
    copies.push(A, B);
    const git = async (cwd: string, ...args: string[]): Promise<string> => {
      const result = await runProcess({
        command: ["git", ...args],
        cwd,
        timeoutMs: 30_000,
      });
      expect(result.exitCode).toBe(0);
      return result.stdout.trim();
    };
    expect(await git(A, "rev-list", "--all", "--count")).toBe("1");
    expect(await git(B, "rev-list", "--all", "--count")).toBe("1");
    expect(await git(A, "remote")).toBe("");
    expect(await git(B, "remote")).toBe("");
    expect(await git(A, "rev-parse", "HEAD^{tree}")).toBe(
      await git(B, "rev-parse", "HEAD^{tree}"),
    );

    const probe = "packages/cache/src/__p17_workspace_probe.txt";
    await writeFile(path.join(A, probe), "condition A only\n", { flag: "wx" });
    expect(await git(A, "status", "--porcelain")).toContain(probe);
    await expect(readFile(path.join(B, probe), "utf8")).rejects.toThrow();
    expect(await git(B, "status", "--porcelain")).toBe("");
    expect(path.resolve(A).startsWith(path.resolve(RUNTIME_ROOT))).toBe(true);
  }, 180_000);
});
