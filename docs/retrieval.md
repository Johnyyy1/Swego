# Candidate Generation v2

## Scope

Candidate Generation v2 combines dense pgvector, lexical full-text, and structural symbol/path retrieval with Reciprocal Rank Fusion (RRF) and deterministic path diversification. It returns repository-memory chunks with their original repository, entity, relationship, path, commit, and temporal provenance. It does not generate an answer or call an LLM.

The provider-neutral `EmbeddingProvider` contract remains in `packages/embeddings`. Ollama is the default local adapter and calls `/api/embed` in bounded batches with `qwen3-embedding:0.6b`. It requests 512 dimensions to match the pgvector column and a 32,768-token context while keeping truncation disabled. OpenAI remains an optional adapter using `text-embedding-3-small` by default. The indexer and retrieval package import only the provider contract and never import a vendor SDK or response type.

## Pipeline

```text
query
  ├─ deterministic query-intent analysis
  ├─ EmbeddingProvider.embed()
  │    └─ repository/time/projection-filtered pgvector candidates
  ├─ PostgreSQL full-text query
  │    └─ repository/time-filtered lexical candidates
  └─ PostgreSQL structural metadata query
       └─ repository/time-filtered symbol/path candidates
                    ↓
        branch path diversification
                    ↓
      merge stable chunk IDs with RRF
                    +
    bounded rank-only file evidence
      → representative code chunks
                    ↓
          strong direct anchors
                    ↓
     bounded one-hop relationship branch
                    ↓
    weak intent-role RRF evidence
      → roles derived from candidate metadata
                    ↓
          path diversification
                    ↓
       bounded 50-candidate pool
                    ↓
       optional local reranker
                    ↓
             final top K
```

An optional post-retrieval stage scores the bounded fused candidates with a local cross-encoder and returns the requested top K. See [Local reranking](reranking.md).

Agent-facing context assembly is a separate consumer of this pipeline. `swega context` starts from a small final result set, adds bounded structural and one-hop support, deduplicates and budgets it, and returns a structured Evidence Pack without changing `search`. See [Evidence Packs](context-packs.md).

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

Lexical retrieval continues to use the stored content-oriented `search_vector` and its GIN index. Inputs are weighted deliberately rather than flattened as equally important text:

- path and `symbolName` use the `simple` text-search configuration at weight A, retaining exact path and identifier-like tokens;
- content uses the `english` configuration at weight B, providing natural-language normalization and stemming;
- `parentSymbol` uses `simple` at weight C;
- source type, source reference, language, and symbol kind use `simple` at weight D, contributing low-weight provenance hints without dominating content and primary identifiers.

The query creates English and exact-token lexemes and joins terms disjunctively for candidate recall. PostgreSQL `ts_rank_cd` orders the lexical pool. The GIN match, repository predicate, and temporal predicate are all applied before the candidate limit.

Structured retrieval uses a separate generated `structural_search_vector` and GIN index. It searches only `symbolName`, `symbolKind`, `parentSymbol`, and normalized path/filename components. Query normalization splits camelCase and PascalCase, path/kebab/snake separators, removes common question framing, and adds conservative singular/suffix variants. Exact raw symbol equality is an independent match condition and orders ahead of ranked metadata matches. Missing structural metadata simply contributes no branch match.

All three branches execute concurrently. Each may internally overfetch up to the centralized default of 300 so repeated structural chunks cannot prevent a relevant path from reaching diversification. Each branch is reduced to at most 100 candidates with the configured per-path cap before fusion. Public search and reranker pools remain bounded at 100 and 50 respectively; there is no query per candidate.

## Query intent and source roles

Every hybrid query is analyzed locally with deterministic engineering-language signals. The compact, composable taxonomy is `implementation`, `tests`, `configuration`, `documentation`, `database_schema`, `migration`, `api_endpoint`, `exact_symbol`, `error_handling`, `authentication`, `authorization`, `history_rationale`, and `general`. A query can emit several signals; each records a bounded confidence and human-readable evidence such as explicit terminology, an engineering phrase, or an identifier/path/filename shape. No model, embedding call, external service, repository scan, or benchmark-specific string participates.

Retrieved evidence is classified conservatively as `production_implementation`, `unit_test`, `integration_test`, `e2e_test`, `configuration`, `documentation`, `generated_reference_documentation`, `database_schema`, `migration`, `api_definition`, `script`, `type_definition`, `fixture`, `generated`, `development_history`, or `unknown`. Classification uses only the already-returned source type, normalized path/filename/extension, and structural symbol kind. Arbitrary JSON or YAML is not assigned an authored role without a recognized filename or directory context; language metadata alone is deliberately insufficient.

Source role is derived over the bounded fused candidate set rather than persisted. The inputs are already stable repository-memory metadata, classification is cheap and deterministic, and persistence would add a rebuildable column and migration without avoiding a database query or scan. This leaves faithful Git data and normalized repository memory unchanged. File paths provide a file-level role while every structural chunk remains an independently ranked result.

After direct, file-evidence, and optional relationship ranks have fused, compatible candidates form one additional rank-only branch. The branch preserves their existing fused order and contributes `weight / (60 + roleRank)` only when the best intent-role compatibility is at least `0.75`. The selected `weak` weight is `0.2`; `none` and `moderate` (`0.5`) remain available for controlled evaluation through `--intent-role-prior`. Incompatible evidence is never removed or penalized, so this is a bounded preference rather than a source-role filter. Exact-symbol compatibility additionally requires exact structural metadata for its strongest preference.

## File-level evidence propagation

File evidence is a rank-only branch layered on chunk retrieval. The selected reranker candidate-generation default is `multi-branch`; direct non-reranked hybrid search remains `none` because propagation improved pool coverage but regressed direct top-10 ordering. It groups the already repository- and time-filtered raw branch candidates by `(repositoryId, path)`, ranks at most 50 promising files, and selects at most two representative chunks from each. Pathless provider entities remain ordinary chunk candidates. Whole files are never returned or queried again.

Three bounded aggregation methods are available for controlled evaluation:

- `max` uses the strongest direct chunk's reciprocal-rank evidence;
- `multi-branch` sums only the best reciprocal-rank contribution from each independent dense, lexical, and structural branch;
- `bounded-top-n` uses the two strongest chunk aggregates, discounting the second contribution.

None of the methods counts every chunk or mixes cosine, lexical, and structural raw scores. Thus a large file cannot win merely by containing more chunks. File ranks contribute one additional `1 / (k + fileRank)` term only to selected representatives. Selection protects exact structural matches, then considers query/symbol overlap, implementation-bearing symbol kinds, independent branch coverage, direct rank, and stable chunk ID. Final path diversification still permits two independently useful symbols from one file.

Use `--file-evidence none|max|multi-branch|bounded-top-n` to reproduce an approach. The benchmark comparison is recorded in [Retrieval evaluation](retrieval-evaluation.md).

## Structural relationship expansion

When explicitly enabled, reranked candidate generation expands at most one hop from bounded strong anchors after file evidence. The TypeScript-family adapter stores high-confidence relative and configured local imports/re-exports with explicit `exact_symbol` or `exact_module` state; `IMPORTED_BY` is their query-time module-level inverse. Exact targets beat representative heuristics. A separate rank-only relationship branch contributes at most 16 representative chunks and never enlarges the 50-candidate reranker pool. Expansion remains disabled by default after the development diagnostic showed predominantly unlabeled relationship-only candidates.

The complete taxonomy, 12-anchor/3-neighbor bounds, representative selection, language fallback, rebuild lifecycle, and historical semantics are documented in [Structural relationship expansion](structural-relationships.md). Use `--relationship-expansion none|bounded` for controlled comparisons.

## Reciprocal Rank Fusion

Candidates merge by deterministic `document_chunks.id`, so a chunk returned by multiple branches is one result. RRF uses 1-based ranks and the conventional default `k = 60`:

```text
rrfScore(d) = sum(1 / (60 + rank(d)))
```

A shared candidate receives one contribution from each branch. Duplicate rows inside one branch contribute only once. Results sort by descending RRF score, then best branch rank, then chunk ID for deterministic ties. Raw cosine, lexical, and structural scores are never added together.

Path diversification keeps at most two candidates from one non-null path at the branch and fused-pool stages. This still permits multiple useful symbols from one file. Pathless issue/PR/commit memory is not grouped into one bucket. The first exact-symbol match from a path reserves a slot even if it appears below the ordinary cap. Input order and stable chunk-ID fusion make ties deterministic.

## Temporal and repository isolation

Hybrid search resolves a missing `before` once at query start and passes that exact cutoff to all three branches. Each branch applies the same predicates in PostgreSQL:

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
- `structuredRank`, `structuredScore`, and `structuredExactMatch` when present in the structural pool;
- `fileEvidenceRank`, `fileEvidenceSources`, and rank-derived `fileEvidenceScore` for propagated representatives;
- `representativeChunkReason` and `propagatedFromFileEvidence` for the bounded synthetic branch;
- `rrfScore` and pre-diversification `rrfRank` for the fused score/order;
- relationship type, source/target path and symbol, import/re-export bindings, exact/module resolution, config provenance, depth, reason, rank, and `retrievedDirectly` when relationship evidence contributed;
- `queryIntents` with confidence/evidence plus `sourceRole`, confidence/evidence, and the best `roleCompatibility` reason;
- `rrfRankBeforeIntentRole`, `intentRoleRank`, and rank-derived `intentRoleScore` when the compatibility branch contributed;
- `rerankerScore`, `rerankerRank`, and `finalRank` when reranking is enabled.

Source-code results also expose `language`, deterministic `symbolId`, `symbolName`, `symbolKind`, `parentSymbol`, and symbol part/count metadata. The CLI's debug output and benchmark failure records may show the symbol name and kind, but never log complete candidate source contents.

Fields for a branch are absent when that branch did not return the chunk. The legacy `similarity` field remains the dense similarity when available and is zero for lexical-only results; consumers should use result order or `rrfScore` for hybrid ranking. Normal CLI output preserves the pre-hybrid JSON shape. `--debug` includes the ranking diagnostics and final 1-based rank.

## Verification

Deterministic unit tests cover dense/lexical/structured fusion, exact RRF arithmetic, query normalization, multi-intent extraction, conservative source-role classification, weak intent-role ranking, exact/camel/Pascal/kebab/snake/path matching, multiple chunks per path, file-evidence interaction, diversification and exact preservation, configurable pools, deterministic ties, null metadata, and projection failures. Database-gated integration tests cover PostgreSQL structured/lexical matching, repository isolation, temporal cutoffs, hybrid deduplication, and embedding idempotency/compatibility. Database tests continue to use the existing `TEST_DATABASE_URL` gate.

The reproducible benchmark format, metrics, and strategy comparison workflow are documented in [Retrieval evaluation](retrieval-evaluation.md). The exploratory examples below predate that harness and remain observations rather than a relevance corpus.

An exploratory comparison used the existing Formbricks snapshot at commit `88a38c081fc7536a4edf74f8b03f9cf9ce4ee2d5`, 8,013 chunks, and its complete Qwen3-Embedding-0.6B projection. These are observations, not a labeled relevance evaluation, and none of the query strings or paths are encoded in production logic.

| Query                                                        | Dense rank 1                                                            | Hybrid rank 1                                               | Observation                                                                                           |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `implementation of user authentication and session handling` | `docs/api-v3-reference/src/paths/api_v3_surveys_validate.yml`           | `apps/web/modules/auth/lib/session.ts`                      | The main session implementation moved from dense rank 5 to hybrid rank 1.                             |
| `where is GitHub authentication configured`                  | `docs/self-hosting/configuration/environment-variables.mdx`             | `docs/self-hosting/configuration/environment-variables.mdx` | The configuration documentation remained first; hybrid added no clear top-result improvement.         |
| `how are unauthorized API requests handled`                  | `docs/api-v3-reference/src/components/responses/V3Unauthorized.yml`     | `apps/web/modules/api/v2/auth/tests/api-wrapper.test.ts`    | An implementation-level auth test moved from dense rank 8 to hybrid rank 1.                           |
| `survey redirects to external URL after completion`          | `docs/api-v3-reference/src/components/schemas/SurveyRedirectEnding.yml` | `apps/web/locales/en-US.json`                               | Repeated lexical matches in the canonical locale catalog outweighed the stronger dense schema result. |

## Known limitations

- The reviewed relevance corpus covers one repository and one author; broader claims require additional repositories and independent reviewers.
- PostgreSQL structural search is token/prefix based; it does not provide trigram typo correction or semantic symbol resolution.
- Repeated terms in large authored catalogs can produce noisy lexical candidates; a relevance corpus is needed before selecting a general mitigation.
- Unsupported and malformed languages still use conservative fixed-size code chunks that can split a declaration from its context.
- Deterministic intent signals recognize explicit engineering language and identifier shapes; they do not perform semantic query understanding. Conservative `unknown` roles and weak compatibility intentionally limit their influence.
- Role classification uses ordered path/filename heuristics. Ambiguous names can still collide—for example, a CI workflow whose filename contains `integration` can resemble an integration test—and should remain visible in debug output rather than being silently filtered.
- Optional reranking adds substantial latency and cannot recover relevant material absent from both direct branches and the bounded one-hop relationship graph. There is no hard source-type/path filter.
- Relationship v1 resolves only relative TypeScript-family modules. Package aliases, semantic references, call graphs, inferred tests, and unsupported languages do not produce edges.
- The schema supports one active embedding projection per chunk and a fixed 512-dimensional vector column.
- HNSW with highly selective repository/time filters can return fewer strong dense candidates than an exact prefiltered strategy.
- Provider adapters validate failures but do not yet retry transient upstream errors.
