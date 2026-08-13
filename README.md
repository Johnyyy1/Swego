# SWEGA

SWEGA is a repository-agnostic memory and intelligence layer for AI coding agents. It is intended to ingest source-code and development history, preserve it as searchable repository memory, and provide relevant historical context to downstream tools.

The current implementation includes the normalized PostgreSQL model, bounded GitHub metadata ingestion, managed Git/source synchronization, structural repository-memory generation, and repository-scoped hybrid retrieval with temporal cutoffs. Agent integrations will be added incrementally.

## Prerequisites

- [Bun](https://bun.sh/) 1.3 or newer
- PostgreSQL with the `pgvector` extension available
- [Ollama](https://ollama.com/) for the default local embedding provider

## Getting started

```bash
bun install
cp .env.example .env
ollama pull qwen3-embedding:0.6b
bun run db:migrate
bun run swega doctor
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

TypeScript, TSX, JavaScript, and JSX files are split at declarations such as functions, methods, classes, interfaces, types, and module-level variables. Every structural chunk carries its language, symbol, parent, and line provenance. Unsupported or malformed source falls back to bounded text chunks, so parser coverage never blocks a memory rebuild.

Generate embeddings, then inspect dense, lexical, and structured hybrid retrieval directly:

```bash
bun run swega embed-memory <repository-id>
bun run swega search <repository-id> "authentication redirect"
bun run swega search <repository-id> "authentication redirect" --before 2025-03-15
bun run swega search <repository-id> "authentication redirect" --rerank
bun run swega search <repository-id> "authentication redirect" --debug
bun run swega search <repository-id> "authentication tests" --intent-role-prior weak --debug
bun run swega benchmark benchmarks/formbricks-smoke.json
bun run swega benchmark benchmarks/formbricks-smoke.json --rerank
bun run swega benchmark benchmarks/formbricks-smoke.json --json
```

Ollama is the default embedding provider, using `http://localhost:11434` and `qwen3-embedding:0.6b`. No OpenAI API key is required. The adapter requests 512-dimensional embeddings to match SWEGA's pgvector projection. PostgreSQL supplies independent lexical and structural symbol/path pools; Reciprocal Rank Fusion and deterministic path diversification combine them with dense retrieval. A local deterministic analyzer adds a weak rank-only preference between composable query intents and conservative source roles; it makes no model call and never filters candidates. `--before` is enforced in PostgreSQL in all three branches. Optional `--rerank` sends the bounded 50-candidate default pool to an explicitly configured loopback llama.cpp reranker. Use `--debug` to show branch, intent/role, fusion, and reranker diagnostics; use `--intent-role-prior none|weak|moderate`, `--candidate-limit`, and `--path-limit` for measured experiments.

The default embedding configuration is:

```dotenv
EMBEDDING_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=qwen3-embedding:0.6b
```

OpenAI remains optional. Select it explicitly with `EMBEDDING_PROVIDER=openai`, set `OPENAI_API_KEY`, and optionally set `OPENAI_EMBEDDING_MODEL`. After changing provider or model, rerun `embed-memory` before searching; SWEGA rejects incompatible stored projections rather than mixing vector spaces.

Check database connectivity, provider availability, and model availability with:

```bash
bun run swega doctor
```

If the local model is missing, the command reports `ollama pull qwen3-embedding:0.6b` as the corrective action.

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

See [the architecture overview](docs/architecture.md), [GitHub ingestion flow](docs/ingestion.md), [Git ingestion flow](docs/git-ingestion.md), [repository-memory design](docs/repository-memory.md), [structural chunking](docs/structural-chunking.md), [retrieval design](docs/retrieval.md), [local reranking](docs/reranking.md), [retrieval evaluation](docs/retrieval-evaluation.md), and [initial decisions](docs/decisions.md) for the intended dependency boundaries.
