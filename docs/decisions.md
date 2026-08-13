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

## Candidate Generation v2 adds structural retrieval and path diversity

Dense and lexical retrieval remain independent baselines. A third PostgreSQL-native branch searches only rebuildable structural metadata: symbol name/kind, parent symbol, and normalized path/filename components. It uses a dedicated generated `tsvector` and GIN index rather than adding structural fields to generic content scoring. Exact symbol equality is retained as a diagnostic and preservation signal.

Each branch internally overfetches up to 300 rows, diversifies to 100 with at most two chunks per path, and then participates in three-way RRF. Fusion is followed by the same deterministic path cap. The internal overfetch is necessary because structural chunking can exhaust a branch before the implementation path reaches fusion; it does not enlarge the public or reranker result bound. Exact-symbol candidates reserve a slot under diversification.

The reranker pool defaults to 50. On the 11-case Formbricks smoke corpus, candidate recall rose from 0.667 for legacy top-30 generation to 0.833 at 50; 75 and 100 added no target coverage while materially increasing local reranking latency. These are smoke measurements rather than general tuning evidence, so the pool and path limits remain centralized and configurable.

## Retrieval evaluation consumes production strategies without owning ranking

`@swega/evaluation` accepts named implementations of the existing `RepositoryMemory` contract. It validates explicitly authored relevance targets, invokes strategies with identical repository/time constraints, and computes metrics from returned provenance. An optional diagnostic extension exposes the exact pre-rerank pool and stage timings without importing database adapters or reproducing dense, lexical, structured, RRF, or reranking logic.

Ground truth uses stable paths and normalized source references rather than derived document/chunk IDs. Benchmark reports contain no source contents. Strategies with execution diagnostics include stage timings and candidate bytes; ranking/metric fields remain deterministic while timing fields do not.

## Optional reranking is a bounded local post-retrieval stage

Reranking uses a separate `Reranker` contract rather than expanding `EmbeddingProvider`; vector generation and query-document relevance scoring are different responsibilities. `RerankedRepositoryMemory` wraps Candidate Generation v2, requests the configured bounded pool (50 by default), de-duplicates by stable chunk ID, and applies reranker scores without changing branch or RRF behavior.

The initial adapter targets a separately started llama.cpp server with the Qwen3-Reranker-0.6B Q4 model. It accepts loopback endpoints only, never starts a runtime or downloads a model, and fails explicitly when configured but unavailable. Search without `--rerank` remains on the hybrid path and never invokes the reranker. Benchmarking opts into a fourth `hybrid+rerank` strategy so quality changes stay measurable.

## Intent-role compatibility is a weak derived rank branch

Query intent is a deterministic, composable retrieval concern, not another AI-provider call. Source role is derived from source type, path, filename, extension, and symbol kind over the already bounded candidate set. Language metadata alone is not enough to turn arbitrary data files into implementation evidence. The role is not persisted: these inputs are stable repository-memory metadata, derivation needs no additional query or scan, and a stored value would be redundant rebuildable state requiring migration and synchronization.

Compatibility remains rank based. Candidates above the conservative compatibility threshold form an additional branch in their existing fused order; the selected weak setting contributes `0.2 / (60 + roleRank)`. `none` and `moderate` (`0.5`) exist for development comparisons. Candidates are never filtered or assigned negative evidence, raw similarity/rank scales remain unmixed, and file/chunk granularity plus relationship-anchor selection remain independent. The weak setting was selected on the frozen development split because it improved top-rank and nDCG metrics with unchanged candidate recall; held-out data did not participate in taxonomy, threshold, mechanism, or weight selection.

## Repository memory uses versioned temporal documents

Searchable documents are derived from normalized entities and Git rather than queried directly from provider-shaped tables. Each version carries both its event time and a conservative availability interval. Deterministic document and chunk IDs make unchanged re-indexing idempotent, while new source versions supersede older versions without destroying historical provenance.

## Structural chunking uses a parser adapter with a text fallback

The document package owns a narrow `SourceStructureParser` contract, so repository-memory generation does not depend on one parser implementation. The initial adapter uses the TypeScript compiler parser without creating a program, resolving imports, type-checking, or executing repository code. It covers TypeScript, TSX, JavaScript, and JSX with one pure-JavaScript runtime already used by SWEGA's toolchain.

Tree-sitter remains a sensible future adapter for broader language coverage, but its Node or WASM runtime still requires separately selected grammar packages and deployment initialization. Adding that surface for four languages already parsed well by TypeScript was not justified in this milestone. Parser errors are enrichment failures: they select the bounded textual strategy rather than failing the memory build.

Structural metadata is persisted directly on derived chunks. Symbol names join paths in the lexical weight-A field; other metadata has lower diagnostic/context weights. This makes exact identifier evidence available to the existing lexical strategy without query-specific rules or changes to dense, RRF, or reranking algorithms.

## Structural expansion uses a rebuildable bounded graph

High-confidence relative imports and re-exports are extracted through a generic document-layer adapter during repository-memory builds and stored in a dedicated derived table. This preserves Git/source separation, supports indexed reverse traversal, and gives relationships their own repository, revision, temporal, and parser provenance. The first adapter supports the TypeScript family; unsupported languages and unresolved aliases retain existing retrieval without invented edges.

Expansion starts only from exact, multi-branch, file-evidence, or top-fused anchors; traverses exactly one hop; and adds a separate rank-only RRF branch. The bounds are 12 anchors, three neighbor documents per anchor, 16 relationship candidates, and four reserved relationship-only slots inside the unchanged 50-candidate reranker pool. Direct imports rank before re-exports and the broader imported-by inverse. Development candidate coverage improved only marginally and most relationship-only candidates were unlabeled, so the stage remains an explicit opt-in for both direct and reranked retrieval.

## Evidence Packs assemble context above retrieval

Agent-facing context is a consumer of `RepositoryMemory`, not another ranking strategy. `EvidencePackBuilder` preserves five deterministic primary anchors, batch-loads at most two local and two relationship candidates per anchor, traverses only the existing depth-one relationship projection, and selects supporting items under a 30,000-character default budget. Ordinary `search` behavior remains unchanged; the `context` command enables bounded relationship support by default and can explicitly disable it.

Context roles are query-relative assembly metadata and remain separate from source roles. Packs retain public source, revision, timestamp, path, line, symbol, retrieval-rank, and relationship provenance while omitting internal chunk/document identifiers. They are query-time, rebuildable outputs rather than persisted source entities. Repository and temporal predicates are enforced in every storage query and checked again before assembly.

The development-only 25-case context benchmark selected five anchors after comparing two through five at the same 30,000-character budget. Against raw ranked chunks, the selected configuration improved required recall from 0.413 to 0.633, supporting recall from 0.320 to 0.420, and complete-pack rate from 0.160 to 0.440. It also improved precision from 0.104 to 0.153 and eliminated observed duplicates, at a measured 121.0 ms mean expansion cost. These results are directional for the pinned repository and do not justify multi-hop graph traversal or an LLM-generated summary.
