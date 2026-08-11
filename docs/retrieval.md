# Repository Memory Retrieval v1

## Scope

Retrieval v1 embeds normalized `DocumentChunk` text, stores vectors in PostgreSQL through pgvector, and returns cosine-ranked chunks with their original repository, entity, relationship, path, commit, and temporal provenance. It does not generate an answer or call an LLM.

The provider-neutral `EmbeddingProvider` contract lives in `packages/embeddings`. Ollama is the default local adapter and calls `/api/embed` in bounded batches with `qwen3-embedding:0.6b`. It explicitly requests 512 dimensions to match the existing pgvector column and a 32,768-token context while keeping truncation disabled, so repository chunks are not silently shortened by Ollama's lower runtime default. OpenAI remains an optional adapter using `text-embedding-3-small` by default. The indexer and retrieval package import only the provider contract and never import a vendor SDK or response type.

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

The default local configuration requires no paid API key:

```dotenv
EMBEDDING_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=qwen3-embedding:0.6b
```

Install the model with `ollama pull qwen3-embedding:0.6b`, then run `swega doctor`. To use OpenAI instead, set `EMBEDDING_PROVIDER=openai`, `OPENAI_API_KEY`, and optionally `OPENAI_EMBEDDING_MODEL`. Environment validation requires the OpenAI key only in that configuration. Programmatic callers can inject any provider that produces the configured 512 dimensions.

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

Before embedding the query, retrieval inspects the repository's stored provider/model/dimension metadata. Missing embeddings or any incompatible projection produce an actionable error instructing the caller to rerun `embed-memory`; search never silently mixes models or operates on a partially switched vector space.

Each result returns content, cosine similarity, source type, internal source ID, availability timestamp, optional path, and source metadata including document/chunk IDs, original source reference, parent relationship, event and availability timestamps, commit SHA, and line range.

## Verification fixture

The database-backed evaluation fixture creates:

- a matching chunk available before `2025-03-15T00:00:00Z`
- a stronger future match available after that cutoff
- an exact match in a different repository

Against a real pgvector PostgreSQL instance, constrained retrieval returned the past chunk, never returned the future chunk, and never crossed repository boundaries. Advancing the cutoff returned the future chunk. Re-running embedding on unchanged chunks wrote zero embeddings.

## Development-repository observations

The SWEGA repository was ingested from GitHub with a limit of five, synchronized from Git with a commit limit of twenty, and built into 98 documents and 261 chunks. An earlier manual inspection used the deterministic lexical provider exported only from `@swega/embeddings/testing`. These results validate the complete storage/query/provenance path, not current Ollama semantic quality.

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

- Qwen3-Embedding-0.6B semantic ranking has not yet been measured against a stable SWEGA relevance corpus.
- Ranking is vector-only: exact identifiers, paths, and uncommon tokens need lexical retrieval.
- Conservative fixed-size code chunks can split a declaration from its context.
- There is no reranker, result diversification, relationship expansion, or source-type/path filtering.
- The schema currently supports one active embedding projection per chunk and a fixed 512-dimensional vector column.
- HNSW is approximate; highly selective repository/time filters can return fewer good candidates than a larger prefiltered candidate strategy.
- Provider adapters validate failures but do not yet retry transient upstream errors.

Retrieval v2 should add PostgreSQL full-text candidates and hybrid rank fusion, introduce a stable evaluation corpus with relevance judgments and temporal cutoffs, and measure candidate recall before considering reranking or code-aware chunking. Those improvements are intentionally not part of v1.
