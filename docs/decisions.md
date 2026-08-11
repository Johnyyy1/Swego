# Initial decisions

## Bun workspaces without an additional orchestrator

The repository uses Bun for dependency management, scripts, and workspace filtering. A separate build orchestrator can be introduced later if task graph size or caching requirements justify it.

## Next.js is a delivery layer

The web application owns HTTP and UI concerns only. Ingestion, persistence, and retrieval behavior belongs in packages or workers so it can be reused by future APIs, CLIs, and coding-agent integrations.

## PostgreSQL with Drizzle

PostgreSQL is the durable system of record. Drizzle provides typed schema and migration tooling while keeping SQL and database behavior visible. The normalized schema stores repository, commit, issue, comment, pull-request, file, and review source records independently of future derived indexing data.

## Validation at process boundaries

Zod validates environment values and external identifiers where they enter the system. Packages receive explicit typed configuration instead of reaching into `process.env` internally.

## Source-specific adapters, source-neutral memory

Git and GitHub have separate packages because local repository history and hosted development activity have different APIs and failure modes. Persisted repository identity uses a generic provider, optional provider ID, and canonical URL so the core model is not tied to GitHub.

## Repository isolation is enforced in the database

Every source entity has a SWEGA UUID and a repository ID. Nested entities repeat the otherwise derivable repository ID so composite foreign keys can reject cross-repository parent references. Provider identifiers remain ordinary columns used for idempotent, repository-scoped upserts.

## GitHub ingestion is bounded and sequential

The GitHub adapter uses Octokit's REST client, pagination iterator, retry plugin, and throttling plugin. It emits normalized values rather than raw API response types. Development ingestion defaults to bounded collections and sends requests sequentially to reduce secondary rate-limit pressure. The indexer owns stage orchestration and database upserts; the CLI is only a process adapter.

## Retrieval is a contract, not a technology choice

The retrieval package defines queries and results but no vector store, embedding provider, or ranking approach. Those choices should follow from a working ingestion slice and observed query needs.
