import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const sha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

export const sha256File = async (filePath: string): Promise<string> =>
  sha256(await readFile(filePath));

export const stableJson = (value: unknown): string =>
  `${JSON.stringify(sortValue(value), null, 2)}\n`;

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortValue(entry)]),
    );
  }
  return value;
};

export const listFilesRecursively = async (root: string): Promise<string[]> => {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const name of (await readdir(directory)).sort()) {
      const absolute = path.join(directory, name);
      const metadata = await stat(absolute);
      if (metadata.isDirectory()) await visit(absolute);
      else if (metadata.isFile()) result.push(path.relative(root, absolute));
    }
  };
  await visit(root);
  return result;
};
