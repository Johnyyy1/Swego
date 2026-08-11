# Repository Memory Retrieval v1

## Scope

Retrieval v1 embeds normalized `DocumentChunk` text, stores vectors in PostgreSQL through pgvector, and returns cosine-ranked chunks with their original repository, entity, relationship, path, commit, and temporal provenance. It does not generate an answer or call an LLM.

The provider-neutral `EmbeddingProvider` contract lives in `packages/embeddings`. The current production adapter calls OpenAI's embeddings endpoint in batches with `text-embedding-3-small` and 512 requested dimensions. OpenAI documents batched string input and configurable dimensions for `text-embedding-3` models in its [embeddings guide](https://developers.openai.com/api/docs/guides/embeddings#obtaining-the-embeddings). The indexer and retrieval package do not import an OpenAI SDK or vendor response type.

## Pipeline

```text
DocumentChunk
  -> EmbeddingProvider.embed()
  -> chunk_embeddings.embedding vector(512)
  -> repository- and time-filtered cosine search
  -> provenance-rich MemorySearchResult
```

Run the projection after building repository memory:

```bash
swega embed-memory <repository-id>
swega search <repository-id> "authentication redirect"
swega search <repository-id> "authentication redirect" --before 2025-03-15
```

`OPENAI_API_KEY` is required by both current CLI commands. `SWEGA_EMBEDDING_MODEL` optionally changes the concrete model. Programmatic callers can inject another provider that produces the configured 512 dimensions.

Embedding writes are restart-safe and idempotent. A chunk is embedded only when no projection exists or its content hash, provider, model, or dimensions changed. Each completed batch is upserted immediately, so a retry resumes from the remaining stale chunks. Switching providers or models rebuilds the single current projection rather than mixing vector spaces.

## Temporal and repository isolation

`searchMemory({ repositoryId, query, limit, before })` embeds the query and executes one pgvector query whose candidate predicate includes:

```sql
chunk_embeddings.repository_id = :repository_id
and chunk_embeddings.provider = :provider
and chunk_embeddings.model = :model
and document_chunks.available_at <= :before
and (
  document_chunks.superseded_at is null
  or document_chunks.superseded_at > :before
)
```

The chunk join is also qualified by both repository ID and chunk ID. A missing `before` is resolved to the query start time, so even ordinary searches cannot expose data marked as becoming available in the future. This filtering happens in PostgreSQL before ranked rows are returned; no downstream model is trusted to discard future information.

Each result returns content, cosine similarity, source type, internal source ID, availability timestamp, optional path, and source metadata including document/chunk IDs, original source reference, parent relationship, event and availability timestamps, commit SHA, and line range.

## Verification fixture

The database-backed evaluation fixture creates:

- a matching chunk available before `2025-03-15T00:00:00Z`
- a stronger future match available after that cutoff
- an exact match in a different repository

Against a real pgvector PostgreSQL instance, constrained retrieval returned the past chunk, never returned the future chunk, and never crossed repository boundaries. Advancing the cutoff returned the future chunk. Re-running embedding on unchanged chunks wrote zero embeddings.

## Development-repository observations

The SWEGA repository was ingested from GitHub with a limit of five, synchronized from Git with a commit limit of twenty, and built into 98 documents and 261 chunks. The environment had no OpenAI API key, so manual inspection used the deterministic lexical provider exported only from `@swega/embeddings/testing`. These results validate the complete storage/query/provenance path, not production semantic quality.

| Query                                       | Representative top results                                                          | Observation                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `temporal retrieval cutoff`                 | `AGENTS.md`, `ARCHITECTURE.md`                                                      | Relevant policy and architecture chunks ranked first.                                                        |
| `GitHub rate limit retry`                   | `packages/github/src/url.test.ts`, `apps/cli/src/arguments.ts`, `docs/ingestion.md` | The ingestion documentation was relevant, but lexical hash collisions promoted unrelated URL and CLI chunks. |
| `managed repository clone hooks submodules` | `packages/git/src/manager.ts`, `workers/indexer/src/persistence.ts`                 | Git manager code ranked first, but unrelated persistence code entered the top three.                         |

Example result shape:

```json
{
  "content": "...",
  "similarity": 0.229,
  "sourceType": "source_code",
  "sourceId": "<internal UUID>",
  "timestamp": "<availableAt>",
  "path": "packages/git/src/manager.ts",
  "sourceMetadata": {
    "sourceReference": "git:<sha>:packages/git/src/manager.ts",
    "commitSha": "<sha>",
    "startLine": 1,
    "endLine": 80
  }
}
```

## Known weaknesses and Retrieval v2 direction

- Production semantic ranking was not measured in this environment because no OpenAI credential was available.
- Ranking is vector-only: exact identifiers, paths, and uncommon tokens need lexical retrieval.
- Conservative fixed-size code chunks can split a declaration from its context.
- There is no reranker, result diversification, relationship expansion, or source-type/path filtering.
- The schema currently supports one active embedding projection per chunk and a fixed 512-dimensional vector column.
- HNSW is approximate; highly selective repository/time filters can return fewer good candidates than a larger prefiltered candidate strategy.
- The OpenAI adapter validates failures but does not yet retry rate limits or transient upstream errors.

Retrieval v2 should add PostgreSQL full-text candidates and hybrid rank fusion, introduce a stable evaluation corpus with relevance judgments and temporal cutoffs, and measure candidate recall before considering reranking or code-aware chunking. Those improvements are intentionally not part of v1.
