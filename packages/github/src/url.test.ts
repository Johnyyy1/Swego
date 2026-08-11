import { describe, expect, test } from "bun:test";

import { GitHubRepositoryUrlError, parseGitHubRepositoryUrl } from "./url";

describe("parseGitHubRepositoryUrl", () => {
  test("parses and canonicalizes a GitHub repository URL", () => {
    expect(
      parseGitHubRepositoryUrl("https://github.com/formbricks/formbricks"),
    ).toEqual({
      owner: "formbricks",
      name: "formbricks",
      url: "https://github.com/formbricks/formbricks",
    });
  });

  test("removes a clone suffix and trailing slash", () => {
    expect(
      parseGitHubRepositoryUrl("https://github.com/octokit/rest.js.git/"),
    ).toEqual({
      owner: "octokit",
      name: "rest.js",
      url: "https://github.com/octokit/rest.js",
    });
  });

  test.each([
    "http://github.com/owner/repository",
    "https://gitlab.com/owner/repository",
    "https://github.com/owner/repository/issues",
    "https://github.com/owner/repository?tab=readme",
    "https://token@github.com/owner/repository",
    "not-a-url",
  ])("rejects unsupported input: %s", (url) => {
    expect(() => parseGitHubRepositoryUrl(url)).toThrow(
      GitHubRepositoryUrlError,
    );
  });
});
