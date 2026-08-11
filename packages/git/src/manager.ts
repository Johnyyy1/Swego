import { constants } from "node:fs";
import { access, mkdir, rename, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { repositoryIdSchema } from "@swega/shared";

import {
  GitCommandError,
  GitFileTooLargeError,
  GitRepositoryError,
} from "./errors";
import { detectLanguage, getFileExtension } from "./language";
import type {
  CheckoutOptions,
  GitCommit,
  GitHistoryOptions,
  GitRepositoryManager,
  GitTrackedFile,
  ManagedGitRepository,
  ManagedRepositoryInput,
  ReadFileOptions,
} from "./types";

const DEFAULT_HISTORY_LIMIT = 100;
const MAX_HISTORY_LIMIT = 10_000;
const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const COMMIT_FORMAT =
  "%H%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x00%b%x00%x1e";

interface GitCliRepositoryManagerOptions {
  rootDirectory: string;
  allowLocalRepositories?: boolean;
}

interface CommandResult {
  stdout: Uint8Array;
  stderr: string;
}

export class GitCliRepositoryManager implements GitRepositoryManager {
  private readonly rootDirectory: string;
  private readonly allowLocalRepositories: boolean;

  constructor(options: GitCliRepositoryManagerOptions) {
    this.rootDirectory = resolve(options.rootDirectory);
    this.allowLocalRepositories = options.allowLocalRepositories ?? false;
  }

  async cloneRepository(
    input: ManagedRepositoryInput,
  ): Promise<ManagedGitRepository> {
    repositoryIdSchema.parse(input.repositoryId);
    this.validateRemoteUrl(input.remoteUrl);
    await mkdir(this.rootDirectory, { recursive: true });

    const directory = this.repositoryDirectory(input.repositoryId);
    const repository = { ...input, directory };

    if (await pathExists(directory)) {
      await this.validateRepository(repository);
      await this.runText(
        ["remote", "set-url", "origin", input.remoteUrl],
        directory,
      );
      return repository;
    }

    const temporaryDirectory = `${directory}.clone.tmp`;
    await rm(temporaryDirectory, { recursive: true, force: true });

    try {
      await this.runText([
        "clone",
        "--no-checkout",
        "--no-recurse-submodules",
        "--origin",
        "origin",
        "--",
        input.remoteUrl,
        temporaryDirectory,
      ]);
      await this.validateRepository({
        ...repository,
        directory: temporaryDirectory,
      });
      await rename(temporaryDirectory, directory);
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true });

      if (await pathExists(directory)) {
        await this.validateRepository(repository);
        return repository;
      }

      throw error;
    }

    return repository;
  }

  async updateRepository(repository: ManagedGitRepository): Promise<void> {
    await this.validateRepository(repository);
    await this.runText(
      ["fetch", "--prune", "--tags", "--no-recurse-submodules", "origin"],
      repository.directory,
    );
  }

  async checkoutRevision(
    repository: ManagedGitRepository,
    revision: string,
    options: CheckoutOptions = {},
  ): Promise<string> {
    const sha = await this.resolveRevision(repository, revision);
    await this.runText(
      [
        "checkout",
        "--detach",
        ...(options.force === false ? [] : ["--force"]),
        "--no-recurse-submodules",
        sha,
      ],
      repository.directory,
    );
    return sha;
  }

  async resolveRevision(
    repository: ManagedGitRepository,
    revision: string,
  ): Promise<string> {
    await this.validateRepository(repository);
    validateRevision(revision);
    return (
      await this.runText(
        ["rev-parse", "--verify", `${revision}^{commit}`],
        repository.directory,
      )
    ).trim();
  }

  async listFiles(
    repository: ManagedGitRepository,
    revision: string,
  ): Promise<readonly GitTrackedFile[]> {
    const revisionSha = await this.resolveRevision(repository, revision);
    const result = await this.run(
      ["ls-tree", "-r", "-l", "-z", "--full-tree", revisionSha],
      repository.directory,
    );
    const output = new TextDecoder().decode(result.stdout);

    return output
      .split("\0")
      .filter(Boolean)
      .flatMap((entry): GitTrackedFile[] => {
        const match =
          /^(\d+) (blob|commit) ([0-9a-f]+)\s+(\d+|-)\t([\s\S]+)$/u.exec(entry);
        if (!match || match[2] !== "blob" || match[4] === "-") {
          return [];
        }

        const path = match[5];
        const objectSha = match[3];
        const sizeText = match[4];
        if (!path || !objectSha || !sizeText) {
          throw new GitRepositoryError(
            `Cannot parse tracked file metadata: ${entry}`,
          );
        }
        const size = Number.parseInt(sizeText, 10);
        if (!Number.isSafeInteger(size)) {
          throw new GitRepositoryError(
            `Cannot parse tracked file metadata: ${entry}`,
          );
        }

        return [
          {
            path,
            objectSha,
            language: detectLanguage(path),
            extension: getFileExtension(path),
            size,
            lastKnownCommitSha: revisionSha,
          },
        ];
      });
  }

  async readFile(
    repository: ManagedGitRepository,
    path: string,
    options: ReadFileOptions = {},
  ): Promise<Uint8Array> {
    validateRepositoryPath(path);
    const revision = options.revision ?? "HEAD";
    const revisionSha = await this.resolveRevision(repository, revision);
    const objectExpression = `${revisionSha}:${path}`;
    const size = Number.parseInt(
      (
        await this.runText(
          ["cat-file", "-s", objectExpression],
          repository.directory,
        )
      ).trim(),
      10,
    );
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_FILE_BYTES;

    if (!Number.isSafeInteger(size) || size < 0) {
      throw new GitRepositoryError(`Cannot determine the size of '${path}'`);
    }
    if (size > maxBytes) {
      throw new GitFileTooLargeError(path, size, maxBytes);
    }

    return (await this.run(["show", objectExpression], repository.directory))
      .stdout;
  }

  async getCommitHistory(
    repository: ManagedGitRepository,
    options: GitHistoryOptions = {},
  ): Promise<readonly GitCommit[]> {
    return this.readHistory(repository, options);
  }

  async getFileHistory(
    repository: ManagedGitRepository,
    path: string,
    options: GitHistoryOptions = {},
  ): Promise<readonly GitCommit[]> {
    validateRepositoryPath(path);
    return this.readHistory(repository, options, path);
  }

  private async readHistory(
    repository: ManagedGitRepository,
    options: GitHistoryOptions,
    path?: string,
  ): Promise<readonly GitCommit[]> {
    const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
      throw new GitRepositoryError(
        `Git history limit must be between 1 and ${MAX_HISTORY_LIMIT}`,
      );
    }

    const revision = options.revision ?? "HEAD";
    const revisionSha = await this.resolveRevision(repository, revision);
    const arguments_ = [
      "log",
      `--format=${COMMIT_FORMAT}`,
      `--max-count=${limit}`,
      ...(options.since ? [`--since=${options.since.toISOString()}`] : []),
      ...(path ? ["--follow"] : []),
      revisionSha,
      "--",
      ...(path ? [path] : []),
    ];
    const output = await this.runText(arguments_, repository.directory);
    return parseCommitHistory(output);
  }

  private async validateRepository(
    repository: ManagedGitRepository,
  ): Promise<void> {
    repositoryIdSchema.parse(repository.repositoryId);
    const expectedDirectory = this.repositoryDirectory(repository.repositoryId);
    const resolvedDirectory = resolve(repository.directory);
    if (
      resolvedDirectory !== expectedDirectory &&
      resolvedDirectory !== `${expectedDirectory}.clone.tmp`
    ) {
      throw new GitRepositoryError(
        "Managed repository directory does not match its repository ID",
      );
    }
    const directoryStats = await stat(repository.directory).catch(() => null);
    if (!directoryStats?.isDirectory()) {
      throw new GitRepositoryError(
        `Managed repository directory does not exist: ${repository.directory}`,
      );
    }

    const isRepository = (
      await this.runText(
        ["rev-parse", "--is-inside-work-tree"],
        repository.directory,
      )
    ).trim();
    if (isRepository !== "true") {
      throw new GitRepositoryError(
        `Directory is not a Git work tree: ${repository.directory}`,
      );
    }
  }

  private repositoryDirectory(repositoryId: string): string {
    const directory = join(this.rootDirectory, repositoryId);
    this.assertManagedPath(directory);
    return directory;
  }

  private assertManagedPath(path: string): void {
    const relativePath = relative(this.rootDirectory, resolve(path));
    if (
      relativePath === "" ||
      (!relativePath.startsWith(`..${sep}`) &&
        relativePath !== ".." &&
        !isAbsolute(relativePath))
    ) {
      return;
    }

    throw new GitRepositoryError(
      `Path escapes managed repository root: ${path}`,
    );
  }

  private validateRemoteUrl(remoteUrl: string): void {
    if (this.allowLocalRepositories && isAbsolute(remoteUrl)) {
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(remoteUrl);
    } catch {
      throw new GitRepositoryError("Invalid Git remote URL");
    }

    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new GitRepositoryError(
        "Git remotes must use HTTPS and must not contain inline credentials",
      );
    }
  }

  private async runText(
    arguments_: readonly string[],
    cwd?: string,
  ): Promise<string> {
    const result = await this.run(arguments_, cwd);
    return new TextDecoder().decode(result.stdout);
  }

  private async run(
    arguments_: readonly string[],
    cwd?: string,
  ): Promise<CommandResult> {
    const subprocess = Bun.spawn(
      [
        "git",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        `protocol.file.allow=${this.allowLocalRepositories ? "always" : "never"}`,
        "-c",
        "submodule.recurse=false",
        ...arguments_,
      ],
      {
        ...(cwd ? { cwd } : {}),
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          LC_ALL: "C",
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(subprocess.stdout).bytes(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);

    if (exitCode !== 0) {
      throw new GitCommandError(arguments_[0] ?? "unknown", exitCode, stderr);
    }

    return { stdout, stderr };
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function validateRevision(revision: string): void {
  if (!revision || revision.startsWith("-") || revision.includes("\0")) {
    throw new GitRepositoryError(`Invalid Git revision: ${revision}`);
  }
}

function validateRepositoryPath(path: string): void {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\0") ||
    path.split("/").some((segment) => segment === "..")
  ) {
    throw new GitRepositoryError(`Invalid repository path: ${path}`);
  }
}

function parseCommitHistory(output: string): GitCommit[] {
  return output
    .split("\x1e")
    .map((record) => record.replace(/^\s+/u, ""))
    .filter(Boolean)
    .map((record) => {
      const fields = record.split("\0");
      const [
        hash,
        parentList,
        authorName,
        authorEmail,
        authoredAt,
        committedAt,
        subject,
        rawBody,
      ] = fields;

      if (
        !hash ||
        parentList === undefined ||
        authorName === undefined ||
        authorEmail === undefined ||
        !authoredAt ||
        !committedAt ||
        subject === undefined ||
        rawBody === undefined
      ) {
        throw new GitRepositoryError("Cannot parse Git commit history output");
      }

      return {
        hash,
        parents: parentList ? parentList.split(" ") : [],
        authorName,
        authorEmail,
        authoredAt: new Date(authoredAt),
        committedAt: new Date(committedAt),
        subject,
        body: rawBody.trimEnd(),
      };
    });
}
