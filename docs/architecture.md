# Architecture

## Purpose

SWEGA will turn a repository's source-code history and development activity into durable, searchable context for coding agents. The current architecture establishes boundaries for that work without selecting an indexing or retrieval strategy prematurely.

## Workspace layout

```text
apps/cli/           Command-line delivery layer
apps/mcp/           Local read-only MCP delivery layer
apps/web/           Next.js delivery layer
packages/agent-context/ Stable agent-facing application API
packages/db/        PostgreSQL schema and Drizzle integration
packages/documents/ Provider-independent document normalization and chunking
packages/embeddings/Embedding-provider contract and concrete adapters
packages/evaluation/ Retrieval benchmark schemas, metrics, and reporting
packages/github/    GitHub development-history source boundary
packages/git/       Managed clones and Git object/history inspection
packages/reranking/ Provider-neutral relevance scoring and local adapter
packages/retrieval/ Repository-memory query contracts and PostgreSQL adapter
packages/shared/    Framework-neutral schemas and shared primitives
workers/indexer/    Background ingestion composition root
docs/               Architecture and decision documentation
```

## Dependency direction

Applications and workers are outer layers. They may depend on packages, while packages must remain independent of Next.js and should depend on one another only through narrow, explicit contracts. The CLI delegates staged ingestion to the indexer worker instead of running it in a web request.

```text
apps/web ───────────────┐
                       ├──> packages/*
workers/indexer ────────┘

packages/* ──X──> apps/web
```

The database package accepts connection configuration instead of reading global environment variables. Environment parsing lives in `packages/shared` and is invoked at process boundaries. This keeps core functionality testable and portable between the web process, workers, scripts, and future integrations.

## Intended data flow

1. A composition root accepts a repository reference.
2. The Git and GitHub adapters collect source and development history.
3. The indexer normalizes provider metadata, synchronizes Git commits, and persists current file metadata through the database package.
4. At the repository-memory boundary, the indexer classifies tracked files with conservative, explainable rules. The document package asks a provider-neutral structure parser for language-specific declarations, produces bounded symbol chunks when supported, and otherwise uses its safe text fallback. Git metadata remains faithful and unfiltered; memory is rebuildable derived data.
5. The indexer generates embeddings through the provider-neutral contract in `packages/embeddings` and stores the current vector projection plus provider/model/dimension metadata for each chunk in pgvector. Ollama is the default local adapter; OpenAI is optional.
6. PostgreSQL retrieval adapters generate independent dense pgvector, lexical full-text, and structural symbol/path candidate pools, applying repository and temporal filters in every SQL query. A rebuildable TypeScript-family relationship projection can add a bounded one-hop rank branch from strong anchors without query-time parsing. The retrieval core rejects incompatible stored embedding projections, fuses branch ranks by stable chunk ID, and limits repeated paths deterministically while preserving exact-symbol candidates.
7. The retrieval package deterministically derives composable query intents and conservative source roles from the query and already-returned provenance. A weak, rank-only compatibility branch adjusts fused order without filtering candidates, changing SQL predicates, flattening chunk granularity, or persisting redundant metadata.
8. When explicitly enabled, the retrieval package sends only the bounded, diversified candidate set through the provider-neutral reranker contract. It preserves dense, lexical, structured, file, relationship, pre-prior/final fusion, role, and reranker diagnostics. The initial llama.cpp adapter permits loopback endpoints only.
9. The retrieval package can consume a few final ranked results as agent-facing anchors, batch-load bounded local structural context, reuse the one-hop relationship projection, and assemble a structured, provenance-rich Evidence Pack under a deterministic character budget. This context primitive does not change search ranking or generate a summary.
10. The Agent Context Service is the stable programmatic boundary for repository discovery, bounded public requests, Evidence Packs, and safe application errors. CLI and MCP adapters call it without owning retrieval or context-assembly logic.
11. The evaluation package consumes the stable retrieval and Evidence Pack interfaces with authored relevance judgments, computes reproducible retrieval/context metrics and intent/role failure diagnostics, and remains independent from production ranking implementations.

The process boundaries, normalized source-data model, ingestion layers, structural repository-memory documents, embedding projection, hybrid retrieval, and bounded Evidence Pack assembly exist today. Repository contents and historical file versions remain authoritative in Git; documents, chunks, embeddings, full-text projections, relationship projections, retrieval rankings, and Evidence Packs are rebuildable derived data. No autonomous agent, answer generation, full semantic analyzer, sandbox, authentication, or billing design is implied by this setup.
