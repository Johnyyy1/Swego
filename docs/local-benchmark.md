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

## P16 validation snapshot

The local gate was run from SWEGA commit
`633706ea06fb788f53aee4a5b2d0e851e789acb2` against
`formbricks/formbricks` repository ID
`a61b0198-8307-41b0-9b51-9c510793cefa` at revision
`88a38c081fc7536a4edf74f8b03f9cf9ce4ee2d5`.

The pinned tree contained 4,550 files. The source-memory build produced 3,914
documents, 23,430 chunks, and 14,815 relationships. The configured projection
is Ollama `qwen3-embedding:0.6b` at 512 dimensions. Re-run
`bun run swega embed-memory <repository-id>` with the explicit local
`DATABASE_URL` above to complete or resume that idempotent projection before
freezing a fresh P17 database volume.
