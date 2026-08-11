import { describe, expect, test } from "bun:test";

import {
  GitHubNormalizationError,
  normalizeCommit,
  normalizeIssue,
  normalizePullRequest,
  normalizePullRequestFile,
  normalizeReview,
} from "./normalize";

describe("GitHub normalization", () => {
  test("preserves nullable issue content and deleted users", () => {
    const issue = normalizeIssue({
      id: 42,
      number: 7,
      title: "Historical issue",
      body: null,
      state: "closed",
      user: null,
      created_at: "2024-01-01T10:00:00Z",
      updated_at: "2024-01-03T10:00:00Z",
      closed_at: "2024-01-02T10:00:00Z",
    });

    expect(issue).toMatchObject({
      providerId: "42",
      number: 7,
      body: null,
      author: null,
      state: "closed",
    });
    expect(issue.createdAt.toISOString()).toBe("2024-01-01T10:00:00.000Z");
    expect(issue.closedAt?.toISOString()).toBe("2024-01-02T10:00:00.000Z");
    expect(issue.sourceUpdatedAt.toISOString()).toBe(
      "2024-01-03T10:00:00.000Z",
    );
  });

  test("normalizes a merged pull request independently from GitHub's closed state", () => {
    const pullRequest = normalizePullRequest({
      id: 84,
      number: 12,
      title: "Merge this",
      body: "Details",
      state: "closed",
      user: { login: "octocat" },
      base: { ref: "main" },
      head: { ref: "feature" },
      created_at: "2024-02-01T10:00:00Z",
      updated_at: "2024-02-03T10:00:00Z",
      merged_at: "2024-02-02T10:00:00Z",
      closed_at: "2024-02-02T10:00:00Z",
    });

    expect(pullRequest.state).toBe("merged");
    expect(pullRequest.baseBranch).toBe("main");
    expect(pullRequest.headBranch).toBe("feature");
    expect(pullRequest.mergedAt?.toISOString()).toBe(
      "2024-02-02T10:00:00.000Z",
    );
  });

  test("maps GitHub's removed file status to the normalized deleted status", () => {
    expect(
      normalizePullRequestFile({
        filename: "src/legacy.ts",
        status: "removed",
        additions: 0,
        deletions: 14,
      }),
    ).toEqual({
      path: "src/legacy.ts",
      status: "deleted",
      additions: 0,
      deletions: 14,
    });
  });

  test("normalizes review states and rejects unknown provider values", () => {
    expect(
      normalizeReview({
        id: 11,
        body: null,
        user: null,
        state: "CHANGES_REQUESTED",
        submitted_at: "2024-03-01T10:00:00Z",
      }),
    ).toMatchObject({
      providerId: "11",
      state: "changes_requested",
      author: null,
    });

    expect(() =>
      normalizeReview({
        id: 12,
        body: null,
        user: null,
        state: "FUTURE_STATE",
        submitted_at: "2024-03-01T10:00:00Z",
      }),
    ).toThrow(GitHubNormalizationError);
  });

  test("preserves distinct author and committer timestamps for commits", () => {
    const commit = normalizeCommit({
      sha: "abc123",
      commit: {
        message: "Add history",
        author: {
          name: "Example Author",
          email: "author@example.com",
          date: "2024-04-01T10:00:00Z",
        },
        committer: { date: "2024-04-02T10:00:00Z" },
      },
    });

    expect(commit.authoredAt.toISOString()).toBe("2024-04-01T10:00:00.000Z");
    expect(commit.committedAt.toISOString()).toBe("2024-04-02T10:00:00.000Z");
  });
});
