# GitHub metadata ingestion

## Command

```bash
swega ingest https://github.com/owner/repository --limit 100 --since 2025-01-01
```

During repository development, the equivalent command is:

```bash
bun run swega ingest https://github.com/owner/repository --limit 100 --since 2025-01-01
```

`DATABASE_URL` is required. `GITHUB_TOKEN` is read from the environment and is recommended even for public repositories because authenticated API requests have a higher rate limit. Private repositories require a token with access to the repository.

`--limit` defaults to 100 and is capped at 1,000. It limits each top-level collection and each pull request's files and reviews. It also bounds issue-list pages so a repository whose issue endpoint mostly returns pull requests cannot trigger an unbounded scan. `--since` accepts an ISO-8601 date and restricts issues, issue comments, pull requests, and commits. GitHub does not provide a `since` parameter for pull-request listing, so SWEGA requests pull requests in descending update order and stops at the cutoff.

## Flow

```text
CLI input and environment validation
              ↓
GitHub URL parsing
              ↓
Repository metadata → repository upsert
              ↓
Issues → issue upserts
              ↓
Comments for bounded issues → parent lookup → comment upserts
              ↓
Pull requests → PR upserts
              ↓
For each bounded PR: files and reviews → child upserts
              ↓
Commits → commit upserts
              ↓
Mark repository indexed
```

`packages/github` owns Octokit, GitHub URL rules, pagination, retries, throttling, and conversion from GitHub payloads to normalized values. Raw Octokit response types do not enter the database or indexer layers. `workers/indexer` owns staged orchestration and Drizzle persistence. `apps/cli` validates process input and composes those boundaries.

## Idempotency and isolation

Upserts use repository-scoped conflict keys:

- repository provider ID or provider/owner/name
- commit SHA
- issue, issue-comment, pull-request, and review provider ID
- pull-request file path within its pull request

All conflicts include repository identity. Nested writes resolve the internal parent UUID and rely on composite foreign keys, so a child cannot be attached to a parent in another repository. A successful run updates `repositories.indexedAt`; failed partial runs leave the previous successful timestamp intact and can be retried.

## Failure handling and logging

Each stage emits JSON logs with the job ID, repository, repository ID when known, stage, count, and duration. Errors are wrapped with the failing stage and repository. Tokens and database URLs are never logged.

Octokit retries transient failures up to three times. Primary and secondary rate limits are logged, and a request is retried once when GitHub's requested delay is at most 60 seconds. Longer waits fail the stage rather than leaving a development command sleeping for an hour. Requests are sent sequentially, following GitHub's recommendation for avoiding secondary limits.

## Cost characteristics

The repository, issue, pull-request, and commit stages each require one request per API page. Issue comments are requested per ingested issue until the global comment limit is reached. Pull-request files and reviews require separate paginated requests for every ingested pull request. These per-parent endpoints are the main scaling risk. The issue endpoint mixes issues and pull requests, so the adapter may fetch a 100-item page to obtain a small number of actual issues.

The current pipeline does not reconcile records omitted from a bounded response, ingest pull-request conversation comments or inline review comments, or preserve historical versions of edited bodies. Commits are obtained through GitHub's API for this iteration; a complete source-history ingestion should ultimately use the Git subsystem as its source of truth.
