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

## Git repositories remain the source of truth for source contents

SWEGA stores managed clones by internal repository UUID. PostgreSQL contains only current tracked-file metadata and the revision that produced it; file bytes and historical versions are read from Git objects. The Git package wraps the installed Git CLI because it provides complete object and history semantics without adding a second Git implementation. All invocations use argument arrays, non-interactive configuration, disabled hooks and submodule recursion, and no repository code execution.

## Embeddings remain behind a provider contract

`EmbeddingProvider` exposes provider identity, model identity, dimensions, and batch embedding without exposing a vendor SDK to the indexer or retrieval package. A separate diagnostic extension exposes the configured endpoint to delivery-layer health checks. Ollama is the default adapter for local development, with `qwen3-embedding:0.6b` requested at the database's established 512 dimensions. OpenAI remains an optional adapter, while deterministic lexical vectors are exported only from a testing entry point. The database stores provider/model/dimension metadata, and retrieval rejects incompatible projections before embedding a query.

## Retrieval v1 uses a rebuildable pgvector projection

PostgreSQL remains the data system of record and pgvector supplies cosine search. One current embedding is stored per deterministic chunk. A content, provider, model, or dimensions change makes that projection stale and causes an idempotent upsert; changing models intentionally rebuilds the projection instead of mixing vector spaces.

Repository ID and the complete temporal validity interval are mandatory SQL predicates. Temporal safety is a data-access invariant, not an instruction delegated to a future language model.

## Hybrid retrieval fuses independent PostgreSQL candidate pools

Dense pgvector retrieval remains the semantic baseline. PostgreSQL full-text search adds exact lexical, identifier, and path evidence without another infrastructure dependency. Both branches apply repository and temporal predicates before limiting candidates, then merge by stable chunk ID through Reciprocal Rank Fusion with `k = 60`.

Raw cosine similarity and full-text rank are retained as diagnostics but are not added together because their scales are not comparable. The full-text projection is generated from document chunks and indexed with GIN, so it remains rebuildable derived data and requires no separate synchronization workflow.

## Retrieval evaluation consumes production strategies without owning ranking

`@swega/evaluation` accepts named implementations of the existing `RepositoryMemory` contract. It validates explicitly authored relevance targets, invokes strategies with identical repository/time constraints, and computes metrics from returned provenance. It does not import database adapters or reproduce dense, lexical, or RRF logic.

Ground truth uses stable paths and normalized source references rather than derived document/chunk IDs. Benchmark reports contain no source contents and omit timing data so identical inputs and rankings produce deterministic machine-readable output.

## Optional reranking is a bounded local post-retrieval stage

Reranking uses a separate `Reranker` contract rather than expanding `EmbeddingProvider`; vector generation and query-document relevance scoring are different responsibilities. `RerankedRepositoryMemory` wraps the existing hybrid strategy, requests 30 fused candidates, de-duplicates by stable chunk ID, and applies reranker scores without changing dense, lexical, or RRF behavior.

The initial adapter targets a separately started llama.cpp server with the Qwen3-Reranker-0.6B Q4 model. It accepts loopback endpoints only, never starts a runtime or downloads a model, and fails explicitly when configured but unavailable. Search without `--rerank` remains byte-for-byte on the hybrid path. Benchmarking opts into a fourth `hybrid+rerank` strategy so quality changes stay measurable.

## Repository memory uses versioned temporal documents

Searchable documents are derived from normalized entities and Git rather than queried directly from provider-shaped tables. Each version carries both its event time and a conservative availability interval. Deterministic document and chunk IDs make unchanged re-indexing idempotent, while new source versions supersede older versions without destroying historical provenance.
