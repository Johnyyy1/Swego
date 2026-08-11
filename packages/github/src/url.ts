import { z } from "zod";

import type { GitHubRepositoryRef } from "./types";

const repositorySegmentSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_.-]+$/u, "contains unsupported characters");

export class GitHubRepositoryUrlError extends Error {
  override readonly name = "GitHubRepositoryUrlError";

  constructor(url: string, reason: string) {
    super(`Invalid GitHub repository URL '${url}': ${reason}`);
  }
}

export function parseGitHubRepositoryUrl(input: string): GitHubRepositoryRef {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new GitHubRepositoryUrlError(input, "expected an HTTPS URL");
  }

  if (url.protocol !== "https:") {
    throw new GitHubRepositoryUrlError(input, "only HTTPS URLs are supported");
  }

  if (url.hostname.toLowerCase() !== "github.com") {
    throw new GitHubRepositoryUrlError(input, "host must be github.com");
  }

  if (url.username || url.password) {
    throw new GitHubRepositoryUrlError(
      input,
      "credentials are not allowed in the URL",
    );
  }

  if (url.search || url.hash) {
    throw new GitHubRepositoryUrlError(
      input,
      "query strings and fragments are not allowed",
    );
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    throw new GitHubRepositoryUrlError(
      input,
      "expected exactly an owner and repository name",
    );
  }

  const ownerResult = repositorySegmentSchema.safeParse(segments[0]);
  const rawName = segments[1]?.replace(/\.git$/u, "");
  const nameResult = repositorySegmentSchema.safeParse(rawName);

  if (!ownerResult.success) {
    throw new GitHubRepositoryUrlError(input, "owner is invalid");
  }

  if (!nameResult.success) {
    throw new GitHubRepositoryUrlError(input, "repository name is invalid");
  }

  const owner = ownerResult.data;
  const name = nameResult.data;

  return {
    owner,
    name,
    url: `https://github.com/${owner}/${name}`,
  };
}
