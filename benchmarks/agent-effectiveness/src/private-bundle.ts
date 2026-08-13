import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listFilesRecursively, sha256, stableJson } from "./hash.ts";

interface PrivateArchiveEntry {
  path: string;
  sha256: string;
  contentBase64: string;
}

interface PrivateArchive {
  schemaVersion: 1;
  files: PrivateArchiveEntry[];
}

interface EncryptedPrivateBundle {
  schemaVersion: 1;
  algorithm: "aes-256-gcm";
  ivBase64: string;
  authTagBase64: string;
  ciphertextBase64: string;
}

const KEYCHAIN_ACCOUNT = "swega-p17-benchmark";
const KEYCHAIN_SERVICE = "swega-agent-effectiveness-v1-grader-key";

const keyFromMacOSKeychain = async (): Promise<string | undefined> => {
  if (process.platform !== "darwin") return undefined;
  const child = Bun.spawn(
    [
      "security",
      "find-generic-password",
      "-a",
      KEYCHAIN_ACCOUNT,
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
    ],
    { stdout: "pipe", stderr: "ignore" },
  );
  const [stdout, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  return exitCode === 0 ? stdout.trim() : undefined;
};

const readKey = async (): Promise<Buffer> => {
  let encoded = process.env.SWEGA_P17_GRADER_KEY?.trim();
  const keyFile = process.env.SWEGA_P17_GRADER_KEY_FILE?.trim();
  if (!encoded && keyFile) encoded = (await readFile(keyFile, "utf8")).trim();
  if (!encoded) encoded = await keyFromMacOSKeychain();
  if (!encoded || !/^[a-fA-F0-9]{64}$/.test(encoded)) {
    throw new Error(
      "Set SWEGA_P17_GRADER_KEY to exactly 64 hex characters (32 bytes)",
    );
  }
  return Buffer.from(encoded, "hex");
};

export const storeGraderKeyInMacOSKeychain = async (): Promise<void> => {
  if (process.platform !== "darwin")
    throw new Error("macOS Keychain storage is only available on macOS");
  const encoded = (await readKey()).toString("hex");
  const child = Bun.spawn(
    [
      "security",
      "add-generic-password",
      "-U",
      "-a",
      KEYCHAIN_ACCOUNT,
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
      encoded,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const [stderr, exitCode] = await Promise.all([
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0)
    throw new Error(`Unable to store grader key in macOS Keychain: ${stderr}`);
};

export const packPrivateDirectory = async (
  sourceDirectory: string,
  destinationFile: string,
): Promise<Array<{ path: string; sha256: string }>> => {
  const files = await listFilesRecursively(sourceDirectory);
  const entries: PrivateArchiveEntry[] = [];
  for (const relativePath of files) {
    const content = await readFile(path.join(sourceDirectory, relativePath));
    entries.push({
      path: relativePath,
      sha256: sha256(content),
      contentBase64: content.toString("base64"),
    });
  }
  const archive: PrivateArchive = { schemaVersion: 1, files: entries };
  const key = await readKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(stableJson(archive), "utf8"),
    cipher.final(),
  ]);
  const bundle: EncryptedPrivateBundle = {
    schemaVersion: 1,
    algorithm: "aes-256-gcm",
    ivBase64: iv.toString("base64"),
    authTagBase64: cipher.getAuthTag().toString("base64"),
    ciphertextBase64: ciphertext.toString("base64"),
  };
  await mkdir(path.dirname(destinationFile), { recursive: true });
  await writeFile(destinationFile, stableJson(bundle), { flag: "wx" });
  return entries.map(({ path: filePath, sha256: digest }) => ({
    path: filePath,
    sha256: digest,
  }));
};

export const hashPrivateDirectory = async (
  sourceDirectory: string,
): Promise<Array<{ path: string; sha256: string }>> => {
  const files = await listFilesRecursively(sourceDirectory);
  return Promise.all(
    files.map(async (relativePath) => ({
      path: relativePath,
      sha256: sha256(await readFile(path.join(sourceDirectory, relativePath))),
    })),
  );
};

export const unpackPrivateBundle = async (
  bundleFile: string,
  destinationDirectory: string,
): Promise<void> => {
  const value: unknown = JSON.parse(await readFile(bundleFile, "utf8"));
  if (
    !value ||
    typeof value !== "object" ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    (value as { algorithm?: unknown }).algorithm !== "aes-256-gcm"
  ) {
    throw new Error("Invalid private bundle schema");
  }
  const bundle = value as EncryptedPrivateBundle;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    await readKey(),
    Buffer.from(bundle.ivBase64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(bundle.authTagBase64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(bundle.ciphertextBase64, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const archive = JSON.parse(plaintext) as PrivateArchive;
  if (archive.schemaVersion !== 1 || !Array.isArray(archive.files))
    throw new Error("Invalid private archive");
  for (const entry of archive.files) {
    if (
      path.isAbsolute(entry.path) ||
      entry.path.split(path.sep).includes("..")
    ) {
      throw new Error(`Unsafe private archive path: ${entry.path}`);
    }
    const content = Buffer.from(entry.contentBase64, "base64");
    if (sha256(content) !== entry.sha256)
      throw new Error(`Private artifact hash mismatch: ${entry.path}`);
    const destination = path.join(destinationDirectory, entry.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, { flag: "wx" });
  }
};
