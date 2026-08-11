import type {
  NormalizedCommit,
  NormalizedIssue,
  NormalizedIssueComment,
  NormalizedPullRequest,
  NormalizedPullRequestFile,
  NormalizedPullRequestFileStatus,
  NormalizedRepository,
  NormalizedReview,
  NormalizedReviewState,
} from "./types";

interface GitHubUserPayload {
  login: string;
}

interface GitHubRepositoryPayload {
  id: number;
  name: string;
  html_url: string;
  default_branch: string | null;
  created_at: string | null;
  updated_at: string | null;
  owner: GitHubUserPayload;
}

interface GitHubIssuePayload {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  state: string;
  user: GitHubUserPayload | null;
  created_at: string;
  closed_at: string | null;
  updated_at: string;
}

interface GitHubIssueCommentPayload {
  id: number;
  issue_url: string;
  body?: string | null;
  user: GitHubUserPayload | null;
  created_at: string;
  updated_at: string;
}

interface GitHubPullRequestPayload {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: GitHubUserPayload | null;
  base: { ref: string };
  head: { ref: string };
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
  updated_at: string;
}

interface GitHubPullRequestFilePayload {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

interface GitHubReviewPayload {
  id: number;
  body: string | null;
  user: GitHubUserPayload | null;
  state: string;
  submitted_at?: string | null;
}

interface GitHubCommitPayload {
  sha: string;
  commit: {
    message: string;
    author?: {
      name?: string | null;
      email?: string | null;
      date?: string | null;
    } | null;
    committer?: {
      date?: string | null;
    } | null;
  };
}

export class GitHubNormalizationError extends Error {
  override readonly name = "GitHubNormalizationError";

  constructor(entity: string, field: string, value: unknown) {
    super(
      `Cannot normalize GitHub ${entity}: invalid ${field} value ${String(value)}`,
    );
  }
}

function requiredDate(
  entity: string,
  field: string,
  value: string | null | undefined,
) {
  if (!value) {
    throw new GitHubNormalizationError(entity, field, value);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new GitHubNormalizationError(entity, field, value);
  }

  return date;
}

function optionalDate(
  entity: string,
  field: string,
  value: string | null | undefined,
): Date | null {
  return value ? requiredDate(entity, field, value) : null;
}

export function normalizeRepository(
  data: GitHubRepositoryPayload,
): NormalizedRepository {
  return {
    provider: "github",
    providerId: String(data.id),
    owner: data.owner.login,
    name: data.name,
    url: data.html_url,
    defaultBranch: data.default_branch,
    createdAt: requiredDate("repository", "created_at", data.created_at),
    sourceUpdatedAt: requiredDate("repository", "updated_at", data.updated_at),
  };
}

export function normalizeIssue(data: GitHubIssuePayload): NormalizedIssue {
  if (data.state !== "open" && data.state !== "closed") {
    throw new GitHubNormalizationError("issue", "state", data.state);
  }

  return {
    providerId: String(data.id),
    number: data.number,
    title: data.title,
    body: data.body ?? null,
    state: data.state,
    author: data.user?.login ?? null,
    createdAt: requiredDate("issue", "created_at", data.created_at),
    closedAt: optionalDate("issue", "closed_at", data.closed_at),
    sourceUpdatedAt: requiredDate("issue", "updated_at", data.updated_at),
  };
}

export function normalizeIssueComment(
  data: GitHubIssueCommentPayload,
): NormalizedIssueComment {
  const match = /\/issues\/(\d+)$/u.exec(data.issue_url);
  const issueNumber = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;

  if (!Number.isSafeInteger(issueNumber)) {
    throw new GitHubNormalizationError(
      "issue comment",
      "issue_url",
      data.issue_url,
    );
  }

  return {
    providerId: String(data.id),
    issueNumber,
    body: data.body ?? null,
    author: data.user?.login ?? null,
    createdAt: requiredDate("issue comment", "created_at", data.created_at),
    sourceUpdatedAt: requiredDate(
      "issue comment",
      "updated_at",
      data.updated_at,
    ),
  };
}

export function normalizePullRequest(
  data: GitHubPullRequestPayload,
): NormalizedPullRequest {
  const state = data.merged_at ? "merged" : data.state;
  if (state !== "open" && state !== "closed" && state !== "merged") {
    throw new GitHubNormalizationError("pull request", "state", state);
  }

  return {
    providerId: String(data.id),
    number: data.number,
    title: data.title,
    body: data.body,
    state,
    author: data.user?.login ?? null,
    baseBranch: data.base.ref,
    headBranch: data.head.ref,
    createdAt: requiredDate("pull request", "created_at", data.created_at),
    mergedAt: optionalDate("pull request", "merged_at", data.merged_at),
    closedAt: optionalDate("pull request", "closed_at", data.closed_at),
    sourceUpdatedAt: requiredDate(
      "pull request",
      "updated_at",
      data.updated_at,
    ),
  };
}

function normalizePullRequestFileStatus(
  status: string,
): NormalizedPullRequestFileStatus {
  switch (status) {
    case "added":
    case "modified":
    case "renamed":
    case "copied":
    case "changed":
    case "unchanged":
      return status;
    case "removed":
      return "deleted";
    default:
      throw new GitHubNormalizationError("pull request file", "status", status);
  }
}

export function normalizePullRequestFile(
  data: GitHubPullRequestFilePayload,
): NormalizedPullRequestFile {
  return {
    path: data.filename,
    status: normalizePullRequestFileStatus(data.status),
    additions: data.additions,
    deletions: data.deletions,
  };
}

function normalizeReviewState(state: string): NormalizedReviewState {
  switch (state.toUpperCase()) {
    case "PENDING":
      return "pending";
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "COMMENTED":
      return "commented";
    case "DISMISSED":
      return "dismissed";
    default:
      throw new GitHubNormalizationError("review", "state", state);
  }
}

export function normalizeReview(data: GitHubReviewPayload): NormalizedReview {
  return {
    providerId: String(data.id),
    body: data.body,
    author: data.user?.login ?? null,
    state: normalizeReviewState(data.state),
    createdAt: requiredDate("review", "submitted_at", data.submitted_at),
  };
}

export function normalizeCommit(data: GitHubCommitPayload): NormalizedCommit {
  const author = data.commit.author?.name;
  if (!author) {
    throw new GitHubNormalizationError("commit", "author.name", author);
  }

  return {
    sha: data.sha,
    message: data.commit.message,
    author,
    authorEmail: data.commit.author?.email ?? null,
    authoredAt: requiredDate("commit", "author.date", data.commit.author?.date),
    committedAt: requiredDate(
      "commit",
      "committer.date",
      data.commit.committer?.date,
    ),
  };
}
