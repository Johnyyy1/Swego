import type { Logger } from "@swega/shared/logging";

export type NormalizedIssueState = "open" | "closed";
export type NormalizedPullRequestState = "open" | "closed" | "merged";
export type NormalizedPullRequestFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "changed"
  | "unchanged";
export type NormalizedReviewState =
  "pending" | "approved" | "changes_requested" | "commented" | "dismissed";

export interface GitHubRepositoryRef {
  owner: string;
  name: string;
  url: string;
}

export interface GitHubListOptions {
  limit: number;
  since?: Date;
}

export interface GitHubClientOptions {
  token?: string;
  logger: Logger;
  maxRateLimitWaitSeconds?: number;
}

export interface NormalizedRepository {
  provider: "github";
  providerId: string;
  owner: string;
  name: string;
  url: string;
  defaultBranch: string | null;
  createdAt: Date;
  sourceUpdatedAt: Date;
}

export interface NormalizedCommit {
  sha: string;
  message: string;
  author: string;
  authorEmail: string | null;
  authoredAt: Date;
  committedAt: Date;
}

export interface NormalizedIssue {
  providerId: string;
  number: number;
  title: string;
  body: string | null;
  state: NormalizedIssueState;
  author: string | null;
  createdAt: Date;
  closedAt: Date | null;
  sourceUpdatedAt: Date;
}

export interface NormalizedIssueComment {
  providerId: string;
  issueNumber: number;
  body: string | null;
  author: string | null;
  createdAt: Date;
  sourceUpdatedAt: Date;
}

export interface NormalizedPullRequest {
  providerId: string;
  number: number;
  title: string;
  body: string | null;
  state: NormalizedPullRequestState;
  author: string | null;
  baseBranch: string;
  headBranch: string;
  createdAt: Date;
  mergedAt: Date | null;
  closedAt: Date | null;
  sourceUpdatedAt: Date;
}

export interface NormalizedPullRequestFile {
  path: string;
  status: NormalizedPullRequestFileStatus;
  additions: number;
  deletions: number;
}

export interface NormalizedReview {
  providerId: string;
  body: string | null;
  author: string | null;
  state: NormalizedReviewState;
  createdAt: Date;
}
