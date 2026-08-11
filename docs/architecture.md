# Architecture

## Purpose

SWEGA will turn a repository's source-code history and development activity into durable, searchable context for coding agents. The current architecture establishes boundaries for that work without selecting an indexing or retrieval strategy prematurely.

## Workspace layout

```text
apps/cli/           Command-line delivery layer
apps/web/           Next.js delivery layer
packages/db/        PostgreSQL schema and Drizzle integration
packages/documents/ Provider-independent document normalization and chunking
packages/embeddings/Embedding-provider contract and concrete adapters
packages/github/    GitHub development-history source boundary
packages/git/       Managed clones and Git object/history inspection
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
4. The document package converts normalized sources into versioned repository-memory documents and conservative text chunks; the indexer persists them as rebuildable derived data.
5. The indexer generates embeddings through `packages/embeddings` and stores the current vector projection for each chunk in pgvector.
6. The PostgreSQL retrieval adapter embeds a query through the same provider/model and applies repository and temporal filters in SQL before returning ranked context.
7. Delivery layers expose results without owning ingestion or retrieval logic.

The process boundaries, normalized source-data model, ingestion layers, repository-memory documents, embedding projection, and semantic retrieval exist today. Repository contents and historical file versions remain authoritative in Git; documents, chunks, and embeddings are rebuildable derived data. No agent, answer-generation, parser, sandbox, authentication, or billing design is implied by this setup.
