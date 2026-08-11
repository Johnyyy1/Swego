# SWEGA

SWEGA is a repository-agnostic memory and intelligence layer for AI coding agents. It is intended to ingest source-code and development history, preserve it as searchable repository memory, and provide relevant historical context to downstream tools.

This repository currently contains the initial architecture only. GitHub ingestion, indexing, retrieval implementations, and agent integrations will be added incrementally.

## Prerequisites

- [Bun](https://bun.sh/) 1.3 or newer
- PostgreSQL

## Getting started

```bash
bun install
cp .env.example .env
bun run db:migrate
bun run dev
```

The web application runs at `http://localhost:3000` by default.

## Common commands

```bash
bun run dev          # Start the Next.js application
bun run typecheck    # Type-check every workspace
bun run lint         # Lint the monorepo
bun run format:check # Check formatting
bun run build        # Create a production web build
bun run db:generate  # Generate migrations after schema changes
bun run db:migrate   # Apply pending PostgreSQL migrations
bun run indexer      # Start the indexer process skeleton
```

See [the architecture overview](docs/architecture.md) and [initial decisions](docs/decisions.md) for the intended dependency boundaries.
# Swega
