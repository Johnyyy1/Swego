# Retrieval evaluation

## Purpose

SWEGA's retrieval evaluator compares production retrieval strategies against explicitly authored relevance judgments. It is a separate `@swega/evaluation` package that consumes the stable `RepositoryMemory` interface; it does not own SQL, embeddings, lexical ranking, RRF, or any other production scoring behavior.

The CLI currently evaluates these strategies in a fixed order:

```text
dense
lexical
hybrid
hybrid+rerank (only with --rerank and a configured local provider)
```

Each strategy receives the same query, repository ID, cutoff, and maximum requested metric cutoff.

## Benchmark format

Benchmark files are strict versioned JSON:

```json
{
  "version": 1,
  "name": "Example repository retrieval",
  "cutoffs": [1, 3, 5, 10],
  "cases": [
    {
      "id": "locate-session-implementation",
      "query": "where is session handling implemented",
      "repositoryId": "123e4567-e89b-42d3-a456-426614174000",
      "before": "2025-03-15T00:00:00.000Z",
      "tags": ["locate-implementation", "authentication"],
      "relevant": [
        {
          "path": "src/auth/session.ts",
          "sourceType": "source_code",
          "grade": 3
        }
      ]
    }
  ]
}
```

Every case needs a stable case ID, query, repository UUID, and at least one relevance target. `before` is optional, but pinning it is strongly recommended so later source versions cannot silently alter the benchmark corpus.

A relevance target must use at least one stable selector:

- `path` matches a document/file path and is the preferred selector for source code across memory rebuilds;
- `sourceReference` matches normalized provider or Git provenance and is useful for issues, pull requests, commits, or a deliberately pinned Git snapshot;
- `sourceType` can narrow either selector but is not sufficient by itself.

Internal document IDs, chunk IDs, and database row IDs are intentionally not accepted as ground truth. They are derived implementation details. Exact duplicate selectors in one case are rejected.

Grades are optional integers from 1 to 3 and default to 1. A retrieved result can credit at most one authored target, and each target is credited only once. This prevents repeated chunks from one matching file from inflating recall or nDCG.

## Metrics

The evaluator reports per-case values and macro-averages across cases:

- Precision@K: uniquely credited relevant results in the first K ranks, divided by K.
- Recall@K: authored relevance targets credited in the first K ranks, divided by the number of targets.
- Hit Rate@K: fraction of cases with at least one credited target in the first K ranks.
- MRR: mean reciprocal rank of the first credited target within the largest configured cutoff.
- nDCG@K: normalized discounted cumulative gain using the optional relevance grades.

Defaults are `@1`, `@3`, `@5`, and `@10`. Human output includes aggregate tables and every query with incomplete recall at the largest cutoff. JSON output includes aggregates, per-case metrics, missing targets, and compact top-result provenance without source contents.

## CLI usage

```bash
bun run swega benchmark benchmarks/formbricks-smoke.json
bun run swega benchmark benchmarks/formbricks-smoke.json --rerank
bun run swega benchmark benchmarks/formbricks-smoke.json --json
```

The benchmark command uses the configured database and embedding provider. Dense and hybrid evaluation therefore retains the normal projection-compatibility checks and requires the configured embedding service to be available. `--rerank` additionally requires `RERANKER_PROVIDER=llama.cpp`, evaluates `hybrid+rerank` against the same cases, and fails rather than silently falling back if that provider is unavailable.

## Authoring a benchmark for a new repository

1. Ingest the repository, synchronize Git, build memory, and generate its embedding projection.
2. Pin the repository revision and choose a historical `before` cutoff when temporal reproducibility matters.
3. Collect realistic code-search intents from reviewed engineering tasks, issue descriptions, onboarding questions, and maintainer interviews.
4. Inspect repository source and development history directly to author relevance targets. Do not use SWEGA search results to manufacture ground truth.
5. Prefer paths for source documents and stable provider `sourceReference` values for non-file entities. Include all independently useful targets, not only one convenient file.
6. Have another developer review ambiguous queries, grades, and target completeness.
7. Run all three strategies, inspect per-query misses, and keep benchmark changes separate from ranking changes during comparison.

The checked-in [Formbricks smoke benchmark](../benchmarks/formbricks-smoke.json) contains eleven manually reviewed cases spanning implementation, configuration, authentication flow, error handling, database schema/migration, API endpoint, tests, feature behavior, exact symbols, and a TSX component. Its repository UUID is local to the current SWEGA database; replace the UUID if Formbricks is registered under a different ID. The labels were authored by inspecting the pinned source snapshot, not from SWEGA's rankings.

## Formbricks smoke baseline

The initial run against the pinned 8,013-chunk Formbricks memory projection produced:

| Strategy      | MRR   | Recall@5 | Recall@10 | Precision@10 | Hit Rate@10 | nDCG@10 |
| ------------- | ----- | -------- | --------- | ------------ | ----------- | ------- |
| dense         | 0.416 | 0.438    | 0.500     | 0.075        | 0.625       | 0.344   |
| lexical       | 0.018 | 0.000    | 0.125     | 0.013        | 0.125       | 0.042   |
| hybrid        | 0.438 | 0.500    | 0.500     | 0.075        | 0.625       | 0.394   |
| hybrid+rerank | 0.531 | 0.500    | 0.500     | 0.075        | 0.625       | 0.450   |

On these eight cases, hybrid improved MRR and nDCG@10 over dense but did not improve Recall@10. The Qwen3 reranker moved the database-model and API-endpoint cases from rank 2 to rank 1, but moved the session-flow case from rank 2 to rank 4. It did not change Recall@10 because reranking cannot add candidates. Lexical-only retrieval performed poorly on the reviewed implementation targets. These results are useful for smoke regression detection only; the fixture is far too small for a statistical quality claim or general ranking decision.

## Structural-chunking smoke comparison

Three explicitly reviewed symbol/component cases were added before rebuilding memory. The 11-case benchmark was run on the same pinned commit immediately before and after switching supported files from fixed text chunks to `source_code_structural_v1`:

| Strategy | Chunking   | MRR   | Recall@5 | Recall@10 | Precision@10 | Hit Rate@10 | nDCG@10 |
| -------- | ---------- | ----- | -------- | --------- | ------------ | ----------- | ------- |
| dense    | text       | 0.439 | 0.500    | 0.545     | 0.073        | 0.636       | 0.398   |
| dense    | structural | 0.561 | 0.576    | 0.576     | 0.082        | 0.727       | 0.477   |
| lexical  | text       | 0.049 | 0.182    | 0.273     | 0.027        | 0.273       | 0.101   |
| lexical  | structural | 0.091 | 0.273    | 0.273     | 0.027        | 0.273       | 0.136   |
| hybrid   | text       | 0.404 | 0.545    | 0.636     | 0.082        | 0.727       | 0.417   |
| hybrid   | structural | 0.530 | 0.621    | 0.667     | 0.091        | 0.818       | 0.518   |

The exact-symbol lexical ranks for `getProxySession` and `validateV3SurveyReferences` improved from 5 to 3; the `EndingCard` implementation changed from a miss to rank 3. In hybrid retrieval those cases improved from 9→3, 3→1, and 2→1 respectively. Other improvements included GitHub-auth configuration (miss→2), the survey validation endpoint (2→1), and redirect behavior (miss→6).

Regressions are also visible. Hybrid session implementation moved from rank 1 to 3, and the broader session-flow case moved from rank 2 to a miss at 10. Dense `EndingCard` moved from rank 1 to 2. The larger, more granular corpus creates additional relevant-looking test/helper candidates; structural units alone do not provide file-level diversification or intent understanding.

The structural rebuild increased source chunks from 7,582 to 23,430 (3.09×), with 2,765 structurally parsed and 1,149 fallback source files. The complete warm 11-case/three-strategy benchmark took 7.1 seconds locally. This remains a smoke comparison, not evidence of statistically meaningful improvement.

## Benchmark size

Eleven cases are enough only for wiring and regression smoke tests. For meaningful directional iteration on one repository, target at least 50 reviewed cases with roughly 5–10 cases per major intent category. Prefer 100 or more cases, multiple reviewers, and a held-out subset before making strong retrieval-quality claims or tuning parameters.
