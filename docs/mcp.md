# Local read-only MCP server

## Architecture

`apps/mcp` is a lightweight local delivery adapter around `AgentContextService`:

```text
MCP client
  -> official MCP stdio transport
  -> three thin tool handlers
  -> AgentContextService
  -> EvidencePackBuilder
  -> retrieval / repository memory
```

Handlers validate protocol input, call the application API, serialize results, and log bounded request metadata. They contain no retrieval, database-query, context-assembly, or provider-selection policy.

MCP v1 uses only stdio. There is no HTTP, SSE, WebSocket, authentication, ingestion, mutation, or hosted-service surface.

## SDK and transport

The server uses the current official modular TypeScript SDK packages:

- `@modelcontextprotocol/server` `2.0.0`;
- `@modelcontextprotocol/client` `2.0.0` in protocol/integration tests;
- `serveStdio()` from `@modelcontextprotocol/server/stdio`, which owns transport setup and supports current and legacy MCP clients from the same server factory.

The implementation follows the official [stdio server guidance](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md). stdout is exclusively MCP JSON-RPC; structured diagnostics are written to stderr.

## Starting the server

From the SWEGA repository root:

```bash
bun run swega:mcp
```

The command loads the root `.env`, parses configuration, creates lightweight database/provider adapters, and begins serving. It does not contact a model, migrate the database, scan repositories, rebuild memory, or validate every repository at startup.

Required runtime configuration:

```dotenv
DATABASE_URL=postgresql://...
EMBEDDING_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=qwen3-embedding:0.6b
```

Normal context calls need the configured embedding provider. The server still starts and repository discovery still works while Ollama is offline. Reranking is optional; configure `RERANKER_PROVIDER=llama.cpp` and the existing llama.cpp variables only when clients should be allowed to request it. SWEGA never launches either provider process.

## Tool surface

Only these read-only tools are advertised:

### `swega_list_repositories`

Use first to discover registered repositories and their memory readiness. Input is an empty object. Output is:

```json
{
  "repositories": [
    {
      "repositoryId": "123e4567-e89b-42d3-a456-426614174000",
      "name": "owner/repo",
      "owner": "owner",
      "repositoryName": "repo",
      "provider": "github",
      "url": "https://github.com/owner/repo",
      "defaultBranch": "main",
      "revision": "abc123",
      "memoryStatus": "ready",
      "ready": true
    }
  ]
}
```

### `swega_get_repository`

Use after discovery to inspect identity, indexed revision, readiness, and temporal coverage.

```json
{
  "repositoryId": "123e4567-e89b-42d3-a456-426614174000"
}
```

### `swega_get_context`

Use for an engineering question or coding task that benefits from bounded implementation evidence.

```json
{
  "repositoryId": "123e4567-e89b-42d3-a456-426614174000",
  "query": "How is survey session authentication validated?",
  "before": "2025-04-01T00:00:00Z",
  "contextBudget": 30000,
  "rerank": false
}
```

`repositoryId` and `query` are required. `before` must be an ISO 8601 timestamp with a timezone. The budget defaults to 30,000 characters and must be an integer from 256 through 100,000. Values are rejected, not clamped. `rerank` defaults to false.

Success returns a concise text summary and the complete Evidence Pack v1 in MCP `structuredContent`. Normal output omits database IDs, raw scores, RRF internals, detailed branch ranks, benchmark labels, and debug diagnostics. See [Agent Context API](agent-context-api.md) for the complete contract.

Application failures set `isError: true` and include compact JSON text:

```json
{
  "error": {
    "code": "REPOSITORY_MEMORY_NOT_READY",
    "message": "Repository memory is not ready for the configured embedding projection."
  }
}
```

JSON text is the compatibility form for all protocol eras; clients should branch on `isError` and parse the text object. Missing required protocol fields or wrong JSON types may be rejected directly by the SDK's input-schema validation.

## Security boundary

The server is strictly read-only repository intelligence. Every tool is advertised with read-only, non-destructive, idempotent, closed-world annotations.

It cannot:

- read arbitrary host paths or accept a filesystem path from a client;
- edit source, create commits, push Git, or delete data;
- run shells, commands, repository code, package managers, tests, or binaries;
- ingest repositories, rebuild memory, mutate repository rows, or execute client-supplied SQL;
- alter model configuration, start provider processes, or expose credentials.

The database/retrieval layer enforces repository UUID and temporal predicates before evidence leaves storage. MCP adds no bypass. Repository text remains untrusted evidence, not server instructions.

## Logging, concurrency, and lifecycle

Successful and failed calls write one structured JSON completion event to stderr with tool name, repository ID when supplied, duration, rerank/cutoff flags, success or safe error code, and—on context success—item/character counts. Source content, queries, vectors, database URLs, tokens, and provider credentials are not logged.

Handlers keep no mutable per-query state. Independent list/context requests, different repositories, and different cutoffs can execute concurrently; existing provider/database limits supply the backpressure rather than a new high-parallelism scheduler.

stdin closure, `SIGINT`, and `SIGTERM` close the MCP transport and database resources. The process never signals Ollama, llama.cpp, or unrelated processes because it does not own them.

## Client configuration

The server command expects the SWEGA repository as its working context so Bun can resolve the root workspace and `.env`. A portable generic stdio configuration is:

```json
{
  "mcpServers": {
    "swega": {
      "command": "bun",
      "args": ["--cwd", "/path/to/swega", "run", "swega:mcp"]
    }
  }
}
```

Do not put database URLs, API keys, or tokens in a shared client configuration. Keep them in SWEGA's uncommitted root `.env` or an approved process environment.

### Codex

The current Codex CLI exposes `codex mcp add <name> -- <command>...`. The locally verified stdio command is:

```bash
codex mcp add swega -- bun --cwd /path/to/swega run swega:mcp
codex mcp get swega
```

Restart or reload the Codex client if it was already running, then ask it to list SWEGA repositories before requesting context. This setup was verified against the available `codex-cli 0.147.0-alpha.6.6`; run `codex mcp add --help` if a later client changes its configuration surface.

### Claude Code

Claude Code's current official stdio syntax is documented in [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp):

```bash
claude mcp add --transport stdio --scope local swega -- \
  bun --cwd /path/to/swega run swega:mcp
claude mcp get swega
```

The equivalent project-scoped `.mcp.json` uses the generic JSON shape above. Claude Code asks for approval before using project-scoped servers.

## Troubleshooting

- `DATABASE_UNAVAILABLE`: confirm PostgreSQL is reachable and migrations are applied with `bun run db:migrate`.
- `REPOSITORY_MEMORY_NOT_READY`: run the existing ingestion/build/embed workflow for that repository and configured embedding projection.
- `EMBEDDING_PROVIDER_UNAVAILABLE`: start the configured provider and ensure its exact configured model is installed; SWEGA will not substitute another provider.
- `RERANKER_UNAVAILABLE`: either call with `rerank: false`, or configure and separately start the loopback llama.cpp reranker described in [Local reranking](reranking.md).
- Client reports invalid stdio output: ensure wrappers and startup scripts write diagnostics to stderr, never stdout. `apps/mcp` itself contains no stdout logging outside the SDK transport.
- Client cannot find Bun or SWEGA: use an absolute Bun executable if necessary and retain `/path/to/swega` as the `--cwd` argument.

Use the official MCP Inspector for an additional manual protocol check:

```bash
npx @modelcontextprotocol/inspector bun --cwd /path/to/swega run swega:mcp
```
