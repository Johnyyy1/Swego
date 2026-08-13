import { writeFile } from "node:fs/promises";
import { runProcess } from "./process.ts";
import type { PatchStats } from "./types.ts";

const git = async (
  workspace: string,
  arguments_: string[],
): Promise<string> => {
  const result = await runProcess({
    command: ["git", ...arguments_],
    cwd: workspace,
    timeoutMs: 60_000,
  });
  if (result.exitCode !== 0)
    throw new Error(`git ${arguments_.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
};

export const collectGitMetrics = async (
  workspace: string,
  patchArtifact: string,
): Promise<{ filesModified: string[]; patchStats: PatchStats }> => {
  await git(workspace, ["add", "--intent-to-add", "--all"]);
  const [patch, names, numstat] = await Promise.all([
    git(workspace, ["diff", "--binary", "--no-ext-diff", "HEAD"]),
    git(workspace, ["diff", "--name-only", "HEAD"]),
    git(workspace, ["diff", "--numstat", "HEAD"]),
  ]);
  await writeFile(patchArtifact, patch, { flag: "wx" });
  const filesModified = names
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.split("\n")) {
    const [added, removed] = line.split("\t");
    if (added && /^\d+$/.test(added)) insertions += Number(added);
    if (removed && /^\d+$/.test(removed)) deletions += Number(removed);
  }
  return {
    filesModified,
    patchStats: { filesChanged: filesModified.length, insertions, deletions },
  };
};
