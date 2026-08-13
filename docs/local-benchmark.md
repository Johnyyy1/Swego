# Local benchmark database

The controlled agent-effectiveness benchmark uses an isolated, local PostgreSQL
17 database with pgvector. It does not use the development `.env` database URL
or any hosted Neon instance.

## Start

```bash
docker compose -f docker-compose.benchmark.yml up -d
docker compose -f docker-compose.benchmark.yml ps
```

The service listens only on `127.0.0.1:5433` and stores its state in the named
`swega-benchmark-pgdata` volume. The pinned image is
`pgvector/pgvector:pg17`; SWEGA migrations create and enable the `vector`
extension. The local database is `swega_benchmark`.

Run all benchmark preparation commands with this explicit process environment;
do not edit or copy secrets from `.env`:

```bash
export DATABASE_URL='postgresql://swega:swega@127.0.0.1:5433/swega_benchmark'
export RERANKER_PROVIDER=''
bun run db:migrate
bun run swega doctor
```

`RERANKER_PROVIDER` is intentionally unset for non-reranked validation. Start
the separately documented loopback llama.cpp service only for an intentional
`rerank: true` run.

## Reset

The following intentionally destroys only the isolated benchmark database and
is suitable for a deterministic rebuild:

```bash
docker compose -f docker-compose.benchmark.yml down -v
docker compose -f docker-compose.benchmark.yml up -d
```

Then reapply migrations and rebuild the pinned repository-memory projection.
Never use this reset command for a development or production database.

## P17 freeze record

Record the following values before the controlled experiment, alongside the
result artifact:

- SWEGA commit;
- canonical repository and repository UUID;
- Formbricks Git SHA;
- document, chunk, relationship, and embedding counts;
- embedding provider, model, and dimensions;
- whether reranking is enabled and, if so, its model and loopback endpoint;
- Evidence Pack character budget;
- MCP command: `bun --cwd /path/to/swega run swega:mcp`.

The benchmark index is source-memory data: it can be dropped and rebuilt from
the pinned Git revision. No credentials belong in this document, compose file,
or Codex MCP configuration.

## P16.5 / P17 freeze

The frozen runtime baseline is SWEGA commit
`8814209` (`docs: add local benchmark database setup`). It was validated against
`formbricks/formbricks` repository ID
`a61b0198-8307-41b0-9b51-9c510793cefa` at revision
`88a38c081fc7536a4edf74f8b03f9cf9ce4ee2d5`.

The benchmark service is PostgreSQL 17.10 with pgvector 0.8.6, in Docker
container `swega-benchmark-postgres-1` and volume
`swega-benchmark_swega-benchmark-pgdata`. Its ready local database contains:

- 3,914 documents;
- 23,430 chunks;
- 14,815 source relationships;
- 23,430 / 23,430 embeddings from Ollama `qwen3-embedding:0.6b` at 512
  dimensions.

Reranking is disabled (`RERANKER_PROVIDER=''`). Evidence Packs use the default
30,000-character context budget. The MCP command is:

```bash
bun run swega:mcp
```

When Codex launches this command, set its working directory to the SWEGA root
and forward the local `DATABASE_URL` above. The validated project-scoped Codex
configuration is:

```toml
[mcp_servers.swega]
command = "/Users/jonas/.bun/bin/bun"
args = ["run", "swega:mcp"]
cwd = "/Users/jonas/Documents/swega"
env_vars = ["DATABASE_URL"]

[mcp_servers.swega.env]
RERANKER_PROVIDER = ""
```

Before starting Codex, export the local database value in the terminal or host
environment. The project configuration contains no database URL or credentials.
The absolute Bun path is intentional for this local Codex host; use the
equivalent absolute path on another host. Do not pass
`--cwd /path` as two Bun arguments: this Bun version requires `--cwd=/path`,
and the configured `cwd` makes that flag unnecessary.

Codex CLI `0.147.0-alpha.6.6` discovered these exact tool names without a
namespace: `swega_list_repositories`, `swega_get_repository`, and
`swega_get_context`. A fresh non-mutating Codex session called
`swega_list_repositories`, selected the ready Formbricks repository at the
pinned revision, then called `swega_get_context`. It received Evidence Pack v1
(15 items, 24,799 / 30,000 characters) and cited
`docs/surveys/link-surveys/verify-email-before-survey.mdx` in its answer.

The initial P16.5 visibility failure was Codex launch configuration, not a
SWEGA interoperability bug: a session-only override used invalid Bun
`--cwd /path` arguments, which caused Bun to emit usage text to MCP stdout and
close before initialization. The working project-scoped configuration above
uses the configured process working directory and a Bun executable visible to
the Codex host. No SWEGA code or MCP semantics changed.
