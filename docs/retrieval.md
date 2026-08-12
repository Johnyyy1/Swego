# Hybrid Repository Memory Retrieval v1

## Scope

Hybrid Retrieval v1 combines the existing dense pgvector search with PostgreSQL full-text search and Reciprocal Rank Fusion (RRF). It returns repository-memory chunks with their original repository, entity, relationship, path, commit, and temporal provenance. It does not generate an answer or call an LLM.

The provider-neutral `EmbeddingProvider` contract remains in `packages/embeddings`. Ollama is the default local adapter and calls `/api/embed` in bounded batches with `qwen3-embedding:0.6b`. It requests 512 dimensions to match the pgvector column and a 32,768-token context while keeping truncation disabled. OpenAI remains an optional adapter using `text-embedding-3-small` by default. The indexer and retrieval package import only the provider contract and never import a vendor SDK or response type.

## Pipeline

```text
query
  ├─ EmbeddingProvider.embed()
  │    └─ repository/time/projection-filtered pgvector top 30
  └─ PostgreSQL full-text query
       └─ repository/time-filtered lexical top 30
                    ↓
          merge by stable chunk ID
                    ↓
           Reciprocal Rank Fusion
                    ↓
             final top N chunks
```

An optional post-retrieval stage can request the top 30 fused candidates, score each query-candidate pair with a local cross-encoder, and return the requested top K. It does not alter candidate generation or RRF. See [Local reranking](reranking.md).

Run the projection after building repository memory, then search:

```bash
swega embed-memory <repository-id>
swega search <repository-id> "authentication redirect"
swega search <repository-id> "authentication redirect" --before 2025-03-15
swega search <repository-id> "authentication redirect" --debug
```

The default local configuration requires no paid API key:

```dotenv
EMBEDDING_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=qwen3-embedding:0.6b
```

Embedding writes remain restart-safe and idempotent. A chunk is embedded only when no projection exists or its content hash, provider, model, or dimensions changed. Each completed batch is upserted immediately, so a retry resumes from remaining stale chunks. Switching providers or models rebuilds the single current projection rather than mixing vector spaces.

## Candidate generation

Dense retrieval preserves the existing cosine-distance query over `chunk_embeddings.embedding vector(512)`. It checks that the repository's complete stored projection matches the configured provider, model, and dimensions before embedding the query. Missing or incompatible embeddings remain actionable errors that instruct the caller to rerun `embed-memory`.

Lexical retrieval uses a stored `tsvector` on `document_chunks` and a GIN index. Inputs are weighted deliberately rather than flattened as equally important text:

- path and `symbolName` use the `simple` text-search configuration at weight A, retaining exact path and identifier-like tokens;
- content uses the `english` configuration at weight B, providing natural-language normalization and stemming;
- `parentSymbol` uses `simple` at weight C;
- source type, source reference, language, and symbol kind use `simple` at weight D, contributing low-weight provenance hints without dominating content and primary identifiers.

The query creates English and exact-token lexemes and joins terms disjunctively for candidate recall. PostgreSQL `ts_rank_cd` orders the lexical pool. The GIN match, repository predicate, and temporal predicate are all applied before the candidate limit.

Dense and lexical candidate limits default independently to 30 and are centralized in `packages/retrieval`. If a caller requests more than 30 final results, each pool grows to at least the requested limit. Both branches execute concurrently; there is no query per candidate.

## Reciprocal Rank Fusion

Candidates merge by deterministic `document_chunks.id`, so a chunk returned by both branches is one result. RRF uses 1-based ranks and the conventional default `k = 60`:

```text
rrfScore(d) = sum(1 / (60 + rank(d)))
```

A shared candidate receives one contribution from each branch. Duplicate rows inside one branch contribute only once. Results sort by descending RRF score, then best branch rank, then chunk ID for deterministic ties.

Cosine similarity and `ts_rank_cd` are not combined directly. They have unrelated scales and distributions, so a weighted raw-score sum would require model-, corpus-, and query-specific calibration. RRF uses only ordinal evidence while preserving both raw values for diagnostics.

## Temporal and repository isolation

Hybrid search resolves a missing `before` once at query start and passes that exact cutoff to both branches. Each branch applies the same predicates in PostgreSQL:

```sql
repository_id = :repository_id
and available_at <= :before
and (
  superseded_at is null
  or superseded_at > :before
)
```

The dense chunk join is additionally qualified by repository ID and chunk ID, and filters the configured provider/model/dimensions. Neither candidate branch can expose a row from another repository or outside the requested validity interval. No downstream model is trusted to discard future information.

## Result diagnostics

Every result retains content and source provenance. Hybrid results may additionally include:

- `denseRank` and `denseSimilarity` when present in the dense pool;
- `lexicalRank` and `lexicalScore` when present in the lexical pool;
- `rrfScore` for the final fused score.

Source-code results also expose `language`, deterministic `symbolId`, `symbolName`, `symbolKind`, `parentSymbol`, and symbol part/count metadata. The CLI's debug output and benchmark failure records may show the symbol name and kind, but never log complete candidate source contents.

Fields for a branch are absent when that branch did not return the chunk. The legacy `similarity` field remains the dense similarity when available and is zero for lexical-only results; consumers should use result order or `rrfScore` for hybrid ranking. Normal CLI output preserves the pre-hybrid JSON shape. `--debug` includes the ranking diagnostics and final 1-based rank.

## Verification

Deterministic unit tests cover dense-only, lexical-only, shared, duplicate, tied, and empty candidate sets; exact RRF arithmetic; independent candidate pools; and projection failures. Database-gated integration tests cover PostgreSQL lexical matching, repository isolation, temporal cutoffs, hybrid deduplication, and the existing embedding idempotency and compatibility invariants. Database tests continue to use the existing `TEST_DATABASE_URL` gate.

The reproducible benchmark format, metrics, and strategy comparison workflow are documented in [Retrieval evaluation](retrieval-evaluation.md). The exploratory examples below predate that harness and remain observations rather than a relevance corpus.

An exploratory comparison used the existing Formbricks snapshot at commit `88a38c081fc7536a4edf74f8b03f9cf9ce4ee2d5`, 8,013 chunks, and its complete Qwen3-Embedding-0.6B projection. These are observations, not a labeled relevance evaluation, and none of the query strings or paths are encoded in production logic.

| Query                                                        | Dense rank 1                                                            | Hybrid rank 1                                               | Observation                                                                                           |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `implementation of user authentication and session handling` | `docs/api-v3-reference/src/paths/api_v3_surveys_validate.yml`           | `apps/web/modules/auth/lib/session.ts`                      | The main session implementation moved from dense rank 5 to hybrid rank 1.                             |
| `where is GitHub authentication configured`                  | `docs/self-hosting/configuration/environment-variables.mdx`             | `docs/self-hosting/configuration/environment-variables.mdx` | The configuration documentation remained first; hybrid added no clear top-result improvement.         |
| `how are unauthorized API requests handled`                  | `docs/api-v3-reference/src/components/responses/V3Unauthorized.yml`     | `apps/web/modules/api/v2/auth/tests/api-wrapper.test.ts`    | An implementation-level auth test moved from dense rank 8 to hybrid rank 1.                           |
| `survey redirects to external URL after completion`          | `docs/api-v3-reference/src/components/schemas/SurveyRedirectEnding.yml` | `apps/web/locales/en-US.json`                               | Repeated lexical matches in the canonical locale catalog outweighed the stronger dense schema result. |

## Known limitations

- Qwen3-Embedding-0.6B ranking still needs a stable relevance corpus with judgments rather than a small set of exploratory queries.
- PostgreSQL text search is token-based; structural symbol names improve exact identifier matching but there is no trigram typo matching.
- Repeated terms in large authored catalogs can produce noisy lexical candidates; a relevance corpus is needed before selecting a general mitigation.
- Unsupported and malformed languages still use conservative fixed-size code chunks that can split a declaration from its context.
- Optional reranking adds latency and cannot recover relevant material absent from the bounded hybrid candidate pool. There is still no result diversification, relationship expansion, or source-type/path filter.
- The schema supports one active embedding projection per chunk and a fixed 512-dimensional vector column.
- HNSW with highly selective repository/time filters can return fewer strong dense candidates than an exact prefiltered strategy.
- Provider adapters validate failures but do not yet retry transient upstream errors.
