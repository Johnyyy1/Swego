# Agent Context API

## Purpose and boundary

`@swega/agent-context` is the stable application boundary for agent-facing repository intelligence. Delivery adapters call it instead of composing retrieval and Evidence Pack construction themselves.

```text
CLI ───────────┐
               ├─> AgentContextService ─> EvidencePackBuilder ─> retrieval / repository memory
MCP ───────────┘
```

The service is independent of CLI parsing, stdout, MCP types, HTTP, UI code, and any coding-agent vendor. It exposes three operations:

- `listRepositories()` discovers registered repositories in deterministic provider/owner/name/ID order.
- `getRepository(repositoryId)` returns bounded identity, revision, readiness, and temporal metadata.
- `buildContext(request, options?)` validates a public request and returns the existing versioned Evidence Pack.

`createPgAgentContextService()` is the PostgreSQL composition helper. The service itself depends on narrow repository-store and Evidence Pack builder ports, so request/error behavior can be tested without PostgreSQL or model processes.

## Repository model

Repository discovery returns:

| Field                | Meaning                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| `repositoryId`       | Stable SWEGA UUID used by all agent requests                                |
| `name`               | Canonical `owner/name` display identity                                     |
| `owner`              | Source owner or namespace                                                   |
| `repositoryName`     | Source repository name                                                      |
| `provider`           | Normalized source provider                                                  |
| `url`                | Canonical repository URL                                                    |
| `defaultBranch`      | Provider default branch when known                                          |
| `revision`           | Revision represented by the current indexed file snapshot when known        |
| `memoryStatus`       | `ready` or `not_ready` for the configured embedding projection              |
| `ready`              | Boolean convenience form of `memoryStatus`                                  |
| ingestion timestamps | Provider, Git, and repository-memory timestamps when known                  |
| `temporalCoverage`   | Earliest/latest indexed evidence availability timestamps when memory exists |

Readiness requires a current repository-memory chunk with an embedding matching the configured provider, model, and dimensions. Discovery does not contact that provider. A repository with source metadata but no compatible memory projection remains discoverable with `ready: false`.

## Public context request

`AgentContextRequest` contains only controls useful to an agent:

| Field           | Required | Type    | Semantics                                                        |
| --------------- | -------- | ------- | ---------------------------------------------------------------- |
| `repositoryId`  | yes      | UUID    | Repository returned by discovery                                 |
| `query`         | yes      | string  | Engineering question or coding task; trimmed, 1–4,000 characters |
| `before`        | no       | `Date`  | Inclusive historical availability cutoff                         |
| `contextBudget` | no       | integer | Evidence-content character budget                                |
| `rerank`        | no       | boolean | Explicitly request the configured local reranker                 |

The default budget is 30,000 Unicode characters. The public minimum is 256 and the hard maximum is 100,000. Values outside the range are rejected rather than clamped. The maximum is slightly over three normal packs and prevents arbitrary multi-megabyte source dumps while leaving room for deliberately larger local-agent contexts.

The CLI retains `primaryEvidenceLimit` and `debug` as separate delivery-adapter options so its existing UX remains available without adding retrieval policy knobs to MCP v1. RRF constants, branch limits, candidate limits, file-evidence controls, source-role weights, and retrieval scores are not part of the public request.

Example:

```ts
const pack = await service.buildContext({
  repositoryId: "123e4567-e89b-42d3-a456-426614174000",
  query: "How is survey session authentication validated?",
  before: new Date("2025-04-01T00:00:00Z"),
  contextBudget: 30_000,
  rerank: false,
});
```

## Public response contract

The response is the existing `EvidencePack` representation. It is not a generated answer. Normal schema v1 output contains:

- `schemaVersion`, repository identity, normalized query, exact effective cutoff, contributing revisions, and inferred query intents;
- ordered evidence with context role, reason, source role, stable source reference, occurrence/availability timestamps, path, revision, line range, language, symbol metadata, faithful content, and optional relationship provenance;
- compact retrieval provenance (`rank` and `exactSymbolMatch`) without dense/vector scores, lexical scores, RRF scores, database identifiers, document IDs, or chunk IDs;
- maximum/used/remaining characters, token estimate, truncation count, and rejection count.

Explicit debug output may additionally include detailed branch/fusion/reranker ranks plus builder decisions and timings. MCP v1 never requests debug output.

Dates are `Date` objects in the TypeScript API and serialize as ISO 8601 strings through `serializeAgentContextResponse()`. Object and array ordering is deterministic for an unchanged data snapshot, cutoff, query, configuration, and provider result.

Compact example shape:

```json
{
  "schemaVersion": 1,
  "repository": {
    "id": "123e4567-e89b-42d3-a456-426614174000",
    "provider": "github",
    "owner": "owner",
    "name": "repo",
    "url": "https://github.com/owner/repo",
    "defaultBranch": "main"
  },
  "query": "How is session authentication validated?",
  "cutoff": "2025-04-01T00:00:00.000Z",
  "revisions": ["abc123"],
  "intents": [
    {
      "intent": "authentication",
      "confidence": 0.9,
      "evidence": ["authentication terminology"]
    }
  ],
  "evidence": [
    {
      "order": 1,
      "contextRole": "PRIMARY",
      "reasons": [
        {
          "kind": "retrieved_primary",
          "detail": "selected from final retrieval rank 1"
        }
      ],
      "source": {
        "sourceType": "source_code",
        "sourceReference": "git:abc123:src/auth.ts",
        "occurredAt": "2025-03-01T00:00:00.000Z",
        "availableAt": "2025-03-01T00:00:00.000Z",
        "path": "src/auth.ts",
        "commitSha": "abc123",
        "startLine": 10,
        "endLine": 24,
        "language": "TypeScript",
        "symbolName": "authenticate",
        "symbolKind": "function",
        "sourceRole": "production_implementation"
      },
      "retrieval": { "rank": 1, "exactSymbolMatch": true },
      "relationships": [],
      "content": "...",
      "contentCharacters": 512,
      "originalContentCharacters": 512,
      "truncated": false
    }
  ],
  "budget": {
    "maximumCharacters": 30000,
    "usedCharacters": 512,
    "remainingCharacters": 29488,
    "estimatedTokens": 128,
    "truncatedItems": 0,
    "rejectedItems": 0
  }
}
```

## Contract versioning

The current Evidence Pack schema version is `1`; MCP does not introduce a new version.

Clients may safely depend on:

- required top-level repository/query/cutoff/revisions/intents/evidence/budget fields;
- evidence ordering, stable provenance fields, content, current context/source/reason/relationship enum meanings, and character-budget invariants;
- optional fields being absent or `null` when provenance does not exist;
- diagnostics and detailed retrieval ranks being absent unless debug output is explicitly requested.

Within v1, adding a new optional field or populating an existing optional field is backwards compatible. Removing or renaming a required field, changing a field's type or meaning, changing budget units, changing temporal semantics, or removing/renaming an established enum value requires a schema-version increment. Existing enum strings are stable; clients should still handle unknown values defensively. A new enum value is treated as a versioned change because exhaustive consumers may otherwise break.

## Structured errors

`AgentContextError` preserves an internal cause but exposes only a stable code, a safe message, and optional bounded scalar details. SQL errors, stacks, credentials, provider endpoints, database URLs, and arbitrary filesystem paths are never serialized.

| Code                             | Meaning                                                                   |
| -------------------------------- | ------------------------------------------------------------------------- |
| `INVALID_REPOSITORY_ID`          | Repository ID is not a UUID                                               |
| `REPOSITORY_NOT_FOUND`           | UUID is valid but not registered                                          |
| `REPOSITORY_MEMORY_NOT_READY`    | Compatible indexed memory is absent or incompatible                       |
| `INVALID_QUERY`                  | Query is empty, whitespace-only, or over the public bound                 |
| `INVALID_CONTEXT_BUDGET`         | Budget is non-integral or outside 256–100,000                             |
| `INVALID_TEMPORAL_CUTOFF`        | Cutoff is invalid                                                         |
| `EMBEDDING_PROVIDER_UNAVAILABLE` | Configured provider/model cannot serve the query                          |
| `RERANKER_UNAVAILABLE`           | Reranking was requested but is unconfigured or unavailable                |
| `DATABASE_UNAVAILABLE`           | Repository storage cannot serve the operation                             |
| `INVALID_REQUEST`                | Unsupported shape or delivery-only option is invalid                      |
| `INTERNAL_ERROR`                 | A safe catch-all, including violated isolation/temporal output invariants |

## Provider, temporal, and isolation semantics

Service construction is lazy with respect to model I/O. Ollama and llama.cpp are never contacted during startup, repository listing, or repository inspection.

- Non-reranked context requires the configured embedding provider only when retrieval embeds the query.
- `rerank: false` never requires a reranker.
- `rerank: true` never silently downgrades and never launches llama.cpp.
- Provider substitution is forbidden; an unavailable local provider is not replaced by OpenAI or another model.

The exact `before` value is passed to Evidence Pack construction. Retrieval and expansion enforce repository and temporal predicates in PostgreSQL, and both the builder and application service reject mismatched repository identity or evidence available after the effective cutoff. Clients identify repositories only by SWEGA UUID, never by filesystem path.
