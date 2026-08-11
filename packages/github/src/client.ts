import { Octokit, RequestError } from "octokit";

import type {
  GitHubClientOptions,
  GitHubListOptions,
  GitHubRepositoryRef,
  NormalizedCommit,
  NormalizedIssue,
  NormalizedIssueComment,
  NormalizedPullRequest,
  NormalizedPullRequestFile,
  NormalizedRepository,
  NormalizedReview,
} from "./types";
import {
  normalizeCommit,
  normalizeIssue,
  normalizeIssueComment,
  normalizePullRequest,
  normalizePullRequestFile,
  normalizeRepository,
  normalizeReview,
} from "./normalize";

const MAX_PAGE_SIZE = 100;

interface RateLimitRequestOptions {
  method: string;
  url: string;
  request: { retryCount?: number };
}

export class GitHubClient {
  readonly authenticated: boolean;
  private readonly octokit: Octokit;
  private requestCount = 0;

  constructor(options: GitHubClientOptions) {
    const maxRateLimitWaitSeconds = options.maxRateLimitWaitSeconds ?? 60;
    const logger = options.logger.child({ component: "github" });

    this.authenticated = Boolean(options.token);
    this.octokit = new Octokit({
      auth: options.token,
      userAgent: "swega/0.0.0",
      request: { timeout: 30_000 },
      retry: {
        retries: 3,
        doNotRetry: [400, 401, 403, 404, 409, 422],
      },
      throttle: {
        onRateLimit: (
          retryAfter: number,
          requestOptions: RateLimitRequestOptions,
        ) => {
          const retryCount = requestOptions.request.retryCount ?? 0;
          const willRetry =
            retryCount === 0 && retryAfter <= maxRateLimitWaitSeconds;

          logger.warn("github.rate_limit", {
            method: requestOptions.method,
            path: requestOptions.url,
            retryAfterSeconds: retryAfter,
            willRetry,
          });

          return willRetry;
        },
        onSecondaryRateLimit: (
          retryAfter: number,
          requestOptions: RateLimitRequestOptions,
        ) => {
          const retryCount = requestOptions.request.retryCount ?? 0;
          const willRetry =
            retryCount === 0 && retryAfter <= maxRateLimitWaitSeconds;

          logger.warn("github.secondary_rate_limit", {
            method: requestOptions.method,
            path: requestOptions.url,
            retryAfterSeconds: retryAfter,
            willRetry,
          });

          return willRetry;
        },
      },
      log: {
        debug: (message) => logger.debug("github.client", { message }),
        info: (message) => logger.info("github.client", { message }),
        warn: (message) => logger.warn("github.client", { message }),
        error: (message) => logger.error("github.client", { message }),
      },
    });

    this.octokit.hook.before("request", () => {
      this.requestCount += 1;
    });
  }

  get apiRequestCount(): number {
    return this.requestCount;
  }

  async getRepository(
    repository: GitHubRepositoryRef,
  ): Promise<NormalizedRepository> {
    const response = await this.octokit.rest.repos.get({
      owner: repository.owner,
      repo: repository.name,
    });

    return normalizeRepository(response.data);
  }

  async listIssues(
    repository: GitHubRepositoryRef,
    options: GitHubListOptions,
  ): Promise<NormalizedIssue[]> {
    const results: NormalizedIssue[] = [];
    const iterator = this.octokit.paginate.iterator(
      this.octokit.rest.issues.listForRepo,
      {
        owner: repository.owner,
        repo: repository.name,
        state: "all",
        sort: "updated",
        direction: "desc",
        per_page: MAX_PAGE_SIZE,
        ...(options.since ? { since: options.since.toISOString() } : {}),
      },
    );

    let pagesRead = 0;
    outer: for await (const response of iterator) {
      pagesRead += 1;
      for (const issue of response.data) {
        if (issue.pull_request) {
          continue;
        }

        results.push(normalizeIssue(issue));
        if (results.length >= options.limit) {
          break outer;
        }
      }

      if (pagesRead >= Math.ceil(options.limit / MAX_PAGE_SIZE)) {
        break;
      }
    }

    return results;
  }

  async listIssueComments(
    repository: GitHubRepositoryRef,
    issueNumbers: readonly number[],
    options: GitHubListOptions,
  ): Promise<NormalizedIssueComment[]> {
    const results: NormalizedIssueComment[] = [];

    for (const issueNumber of issueNumbers) {
      if (results.length >= options.limit) {
        break;
      }

      const iterator = this.octokit.paginate.iterator(
        this.octokit.rest.issues.listComments,
        {
          owner: repository.owner,
          repo: repository.name,
          issue_number: issueNumber,
          per_page: Math.min(options.limit - results.length, MAX_PAGE_SIZE),
          ...(options.since ? { since: options.since.toISOString() } : {}),
        },
      );

      for await (const response of iterator) {
        for (const comment of response.data) {
          results.push(normalizeIssueComment(comment));
          if (results.length >= options.limit) {
            break;
          }
        }

        if (results.length >= options.limit) {
          break;
        }
      }
    }

    return results;
  }

  async listPullRequests(
    repository: GitHubRepositoryRef,
    options: GitHubListOptions,
  ): Promise<NormalizedPullRequest[]> {
    const results: NormalizedPullRequest[] = [];
    const iterator = this.octokit.paginate.iterator(
      this.octokit.rest.pulls.list,
      {
        owner: repository.owner,
        repo: repository.name,
        state: "all",
        sort: "updated",
        direction: "desc",
        per_page: Math.min(options.limit, MAX_PAGE_SIZE),
      },
    );

    outer: for await (const response of iterator) {
      for (const pullRequest of response.data) {
        if (
          options.since &&
          new Date(pullRequest.updated_at).getTime() < options.since.getTime()
        ) {
          break outer;
        }

        results.push(normalizePullRequest(pullRequest));
        if (results.length >= options.limit) {
          break outer;
        }
      }
    }

    return results;
  }

  async listPullRequestFiles(
    repository: GitHubRepositoryRef,
    pullRequestNumber: number,
    options: GitHubListOptions,
  ): Promise<NormalizedPullRequestFile[]> {
    const results: NormalizedPullRequestFile[] = [];
    const iterator = this.octokit.paginate.iterator(
      this.octokit.rest.pulls.listFiles,
      {
        owner: repository.owner,
        repo: repository.name,
        pull_number: pullRequestNumber,
        per_page: Math.min(options.limit, MAX_PAGE_SIZE),
      },
    );

    outer: for await (const response of iterator) {
      for (const file of response.data) {
        results.push(normalizePullRequestFile(file));
        if (results.length >= options.limit) {
          break outer;
        }
      }
    }

    return results;
  }

  async listReviews(
    repository: GitHubRepositoryRef,
    pullRequestNumber: number,
    options: GitHubListOptions,
  ): Promise<NormalizedReview[]> {
    const results: NormalizedReview[] = [];
    const iterator = this.octokit.paginate.iterator(
      this.octokit.rest.pulls.listReviews,
      {
        owner: repository.owner,
        repo: repository.name,
        pull_number: pullRequestNumber,
        per_page: Math.min(options.limit, MAX_PAGE_SIZE),
      },
    );

    outer: for await (const response of iterator) {
      for (const review of response.data) {
        results.push(normalizeReview(review));
        if (results.length >= options.limit) {
          break outer;
        }
      }
    }

    return results;
  }

  async listCommits(
    repository: GitHubRepositoryRef,
    options: GitHubListOptions,
  ): Promise<NormalizedCommit[]> {
    const results: NormalizedCommit[] = [];
    const iterator = this.octokit.paginate.iterator(
      this.octokit.rest.repos.listCommits,
      {
        owner: repository.owner,
        repo: repository.name,
        per_page: Math.min(options.limit, MAX_PAGE_SIZE),
        ...(options.since ? { since: options.since.toISOString() } : {}),
      },
    );

    try {
      outer: for await (const response of iterator) {
        for (const commit of response.data) {
          results.push(normalizeCommit(commit));
          if (results.length >= options.limit) {
            break outer;
          }
        }
      }
    } catch (error) {
      if (error instanceof RequestError && error.status === 409) {
        return [];
      }

      throw error;
    }

    return results;
  }
}
