# SWEGA

SWEGA is a repository-agnostic memory and intelligence layer for AI coding agents. It is intended to ingest source-code and development history, preserve it as searchable repository memory, and provide relevant historical context to downstream tools.

The current implementation includes the normalized PostgreSQL model, bounded GitHub metadata ingestion, managed Git/source synchronization, repository-memory document generation, and repository-scoped semantic retrieval with temporal cutoffs. Agent integrations will be added incrementally.

## Prerequisites

- [Bun](https://bun.sh/) 1.3 or newer
- PostgreSQL with the `pgvector` extension available

## Getting started

```bash
bun install
cp .env.example .env
bun run db:migrate
bun run dev
```

The repository-root `.env` is the single local environment file. SWEGA's runtime entry points load it explicitly; workspace-local `.env` copies are neither needed nor supported. Values already exported by the shell take precedence.

The web application runs at `http://localhost:3000` by default.

Run a bounded GitHub metadata ingestion with:

```bash
bun run swega ingest https://github.com/octocat/Hello-World --limit 10
```

`GITHUB_TOKEN` is optional for public repositories but recommended for a higher API rate limit. Running `bun link` from the repository root makes the equivalent `swega ingest ...` command available directly.

After metadata ingestion returns the repository UUID, synchronize its Git history and tracked files with:

```bash
bun run swega ingest-git <repository-id> --limit 100
```

Managed clones default to `.swega/repositories`. Set `SWEGA_REPOSITORY_DIR` to use another location.

Build versioned repository-memory documents and text chunks after metadata and Git synchronization:

```bash
bun run swega build-memory <repository-id>
```

Generate embeddings, then inspect semantic retrieval directly:

```bash
bun run swega embed-memory <repository-id>
bun run swega search <repository-id> "authentication redirect"
bun run swega search <repository-id> "authentication redirect" --before 2025-03-15
```

The current CLI adapter uses OpenAI embeddings and requires `OPENAI_API_KEY`. The core embedding contract is vendor-neutral. `--before` is enforced in PostgreSQL against each chunk's temporal validity interval.

## Common commands

```bash
bun run dev          # Start the Next.js application
bun run typecheck    # Type-check every workspace
bun run test         # Run unit tests
bun run lint         # Lint the monorepo
bun run format:check # Check formatting
bun run build        # Create a production web build
bun run db:check     # Validate Drizzle migration history
bun run db:generate  # Generate migrations after schema changes
bun run db:migrate   # Apply pending PostgreSQL migrations
```

See [the architecture overview](docs/architecture.md), [GitHub ingestion flow](docs/ingestion.md), [Git ingestion flow](docs/git-ingestion.md), [repository-memory design](docs/repository-memory.md), [retrieval design and evaluation](docs/retrieval.md), and [initial decisions](docs/decisions.md) for the intended dependency boundaries.
