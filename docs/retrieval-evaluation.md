# Retrieval evaluation

## Purpose

SWEGA's retrieval evaluator compares production retrieval strategies against explicitly authored relevance judgments. It is a separate `@swega/evaluation` package that consumes the stable `RepositoryMemory` interface; it does not own SQL, embeddings, lexical ranking, RRF, or any other production scoring behavior.

The CLI currently evaluates these strategies in a fixed order:

```text
dense
lexical
structured
hybrid
hybrid+rerank (only with --rerank and a configured local provider)
```

Each strategy receives the same query, repository ID, cutoff, and maximum requested metric cutoff. A strategy that implements the optional diagnostic interface also returns its exact pre-rerank pool and stage measurements in the same execution.

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

Development and held-out files additionally require a pinned `repositoryRevision`, a `groundTruthMethod`, and `category`, `difficulty`, and review `notes` on every case. Supported categories cover implementation, exact symbols, feature flows, configuration, endpoints, authorization, schema, migrations, errors, tests, UI, utilities, cross-file behavior, repository infrastructure, and temporal retrieval. An optional `symbolName` narrows a path target to one structural chunk and requires that path.

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

For diagnostic strategies such as `hybrid+rerank`, the report additionally includes candidate recall across the complete pre-rerank pool, candidate count and UTF-8 formatted-candidate bytes, candidate-generation/reranking durations, and an outcome for every target:

- A, `absent_from_candidate_pool`: no chunk from the target file entered the pool;
- B, `wrong_chunk_from_target_file`: the file entered, but the labeled symbol/chunk did not;
- C, `reranked_below_cutoff`: the target chunk entered but finished below K;
- D, `successfully_returned`: the target was returned within K.

Category aggregates are emitted for inspection, while the human report suppresses categories with fewer than three cases to avoid over-interpreting tiny samples.

Relationship-enabled diagnostic reports also count relationship-only candidates, authored targets recovered only by those candidates, and relationship-only candidates matching no authored target in the case. Baseline/enabled JSON reports can be compared to identify direct targets displaced from the fixed pool. “False positive” in this report is corpus-relative and does not claim that an unlabeled candidate is universally irrelevant.

Intent-aware reports preserve the benchmark category and add predicted query intents with confidence/evidence, classified roles for every relevance target, the returned source-role distribution, and compact result roles/ranks. Diagnostic strategies also classify each target as missing, represented only by the wrong chunk, promoted or demoted across the compatibility stage, still below the candidate cutoff, reversed by the reranker, or unchanged. These fields analyze ranking behavior only; they do not alter ground-truth matching or relevance grades.

Existing Precision/Recall/MRR/nDCG definitions are unchanged. Candidate recall is separately named and never substituted for final Recall@K. Timing fields make diagnostic reports intentionally nondeterministic; ranking and metric fields remain reproducible for deterministic providers.

Evidence Pack evaluation is intentionally separate from ranked retrieval evaluation. The checked-in 25-case development corpus compares raw top-ranked chunks and assembled context under the same exact character budget, reporting required/supporting recall, complete-pack rate, precision, duplicate ratio, noise, relevant-file diversity, payload, and stage latency without an opaque combined score. It also reports relationship-derived labeled precision, exact-target landing rate over symbol-bearing relationship items, and module-only fallback rate. Labels were authored by direct source inspection at a pinned revision.

Context corpora use split-specific sealing rules: development accepts 20–30 cases; held-out accepts 10–15 and requires `corpusAuthor`, `reviewCount`, and `sealedAt`. The Formbricks alias/exact-symbol context held-out was checksumed before implementation and is evaluated once only after development analysis and design freeze. See [Evidence Packs](context-packs.md) for schema, methodology, comparisons, and limitations.

The completed alias/exact-symbol development and sole sealed held-out results are recorded in the
[milestone report](../benchmarks/formbricks-context-alias-symbol-report.md). The held-out result was
not used for implementation or parameter changes.

## CLI usage

```bash
bun run swega benchmark benchmarks/formbricks-smoke.json
bun run swega benchmark benchmarks/formbricks-smoke.json --rerank
bun run swega benchmark benchmarks/formbricks-smoke.json --json
bun run swega benchmark benchmarks/formbricks-smoke.json --rerank --candidate-limit 50 --path-limit 2
bun run swega benchmark benchmarks/formbricks-development.json --file-evidence multi-branch
bun run swega benchmark benchmarks/formbricks-development.json --rerank --relationship-expansion none
bun run swega benchmark benchmarks/formbricks-development.json --intent-role-prior weak
bun run swega context-benchmark benchmarks/formbricks-context-development.json
bun run swega context-benchmark benchmarks/formbricks-context-development.json --json
bun run swega context-benchmark benchmarks/formbricks-context-held-out.json --json
```

The benchmark command uses the configured database and embedding provider. Dense and hybrid evaluation therefore retains the normal projection-compatibility checks and requires the configured embedding service to be available. `--rerank` additionally requires `RERANKER_PROVIDER=llama.cpp`, evaluates `hybrid+rerank` against the same cases, and fails rather than silently falling back if that provider is unavailable.

## Authoring a benchmark for a new repository

1. Ingest the repository, synchronize Git, build memory, and generate its embedding projection.
2. Pin the repository revision and choose a historical `before` cutoff when temporal reproducibility matters.
3. Collect realistic code-search intents from reviewed engineering tasks, issue descriptions, onboarding questions, and maintainer interviews.
4. Inspect repository source and development history directly to author relevance targets. Do not use SWEGA search results to manufacture ground truth.
5. Prefer paths for source documents and stable provider `sourceReference` values for non-file entities. Include all independently useful targets, not only one convenient file.
6. Have another developer review ambiguous queries, grades, and target completeness.
7. Run all four base strategies, inspect per-query misses, and keep benchmark changes separate from ranking changes during comparison.

The checked-in Formbricks corpus has three roles:

- [smoke](../benchmarks/formbricks-smoke.json): 11 fast, backward-compatible regression cases;
- [development](../benchmarks/formbricks-development.json): 40 cases and 57 targets used to compare retrieval changes;
- [held-out](../benchmarks/formbricks-held-out.json): 15 cases and 26 targets withheld until the file-propagation approach and bounds were selected.

Together the development and held-out splits contain 55 cases across 15 categories, with easy navigation, medium semantic, broad architectural, multi-file, and one historical query. Every label was authored by using `git show`, `git grep`, and commit history against Formbricks revision `88a38c081fc7536a4edf74f8b03f9cf9ce4ee2d5`. Notes state why the path or symbol is relevant. SWEGA rankings were not used to create labels. A single author performed the source review, so these are manually reviewable judgments rather than independent inter-annotator agreement.

| Category                  | Development | Held-out |
| ------------------------- | ----------: | -------: |
| implementation            |           3 |        1 |
| exact symbol              |           3 |        1 |
| feature flow              |           3 |        1 |
| configuration             |           3 |        1 |
| API endpoint              |           3 |        1 |
| authorization             |           3 |        1 |
| database schema           |           3 |        1 |
| migration                 |           3 |        1 |
| error handling            |           3 |        1 |
| tests                     |           3 |        1 |
| UI component              |           3 |        1 |
| utility                   |           3 |        1 |
| cross-file                |           3 |        1 |
| repository infrastructure |           1 |        1 |
| temporal                  |           0 |        1 |

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

## Candidate Generation v2 smoke result

The selected 50-candidate/two-per-path configuration raised complete pre-rerank target coverage from 0.667 to 0.833. Hybrid+rerank changed from MRR 0.697, Recall@5 0.636, Recall@10 0.667, Hit Rate@10 0.818, and nDCG@10 0.610 to 0.652, 0.697, 0.788, 0.909, and 0.629 respectively. Candidate recall, final recall, hit rate, and nDCG improved; MRR regressed and is explicitly not presented as an across-the-board quality gain.

| Strategy      |   MRR | Recall@5 | Recall@10 | Hit Rate@10 | nDCG@10 |
| ------------- | ----: | -------: | --------: | ----------: | ------: |
| dense         | 0.561 |    0.576 |     0.576 |       0.727 |   0.477 |
| lexical       | 0.091 |    0.273 |     0.273 |       0.273 |   0.136 |
| hybrid        | 0.405 |    0.500 |     0.545 |       0.636 |   0.433 |
| hybrid+rerank | 0.652 |    0.697 |     0.788 |       0.909 |   0.629 |

The direct hybrid top-10 ranking regressed from the pre-change structural baseline (MRR 0.530, Recall@10 0.667, nDCG@10 0.518). Candidate Generation v2 deliberately optimizes a broader, more diverse pre-rerank pool; RRF alone does not reliably order its three heterogeneous intent signals. Non-reranked search therefore remains a known regression requiring broader evaluation before another fusion change.

The exact pool-size measurements and per-query changes are recorded in [Local reranking](reranking.md). The remaining unauthorized-request failure demonstrates both diagnostic categories: one implementation file is present but reranked below 10, while the other is absent from the pool.

## File evidence development comparison

The 40-case development split was frozen before ranking changes. An order-preserving diagnostic reranker requested the production 50-candidate pool for each approach, allowing candidate coverage and direct fused ordering to be compared without using Qwen to select an aggregation formula.

| File evidence |   MRR | Recall@10 | Hit@10 | nDCG@10 | Candidate recall | A: absent | B: wrong chunk | Mean bytes | Generation |
| ------------- | ----: | --------: | -----: | ------: | ---------------: | --------: | -------------: | ---------: | ---------: |
| none          | 0.362 |     0.479 |  0.600 |   0.372 |            0.592 |        14 |             11 |    134,663 |   642.8 ms |
| max           | 0.342 |     0.454 |  0.550 |   0.348 |            0.667 |        14 |              7 |    137,185 |   706.0 ms |
| multi-branch  | 0.342 |     0.454 |  0.550 |   0.348 |            0.667 |        13 |              8 |    133,211 |   677.7 ms |
| bounded top-N | 0.341 |     0.442 |  0.550 |   0.346 |            0.667 |        14 |              7 |    138,604 |   673.9 ms |

All three bounded propagation methods recovered the same aggregate target coverage and preserved exact-symbol Recall@10 at 1.0. `multi-branch` was selected before held-out evaluation because it had the fewest completely absent target files, the smallest payload, and represents independent retriever agreement. Its mean candidate-generation increase was 34.9 ms (5.4%) over the cached-query comparison. Max evidence had one fewer wrong-chunk classification but one more absent file and a larger payload; bounded top-N also lost additional direct top-10 recall.

The direct fused ranking regression is material: configuration and authorization each moved from 0.167 to 0 Recall@10 in this three-case-per-category development sample, and test MRR moved from 0.833 to 0.583 despite unchanged test Recall@10 of 1.0. Consequently, multi-branch propagation is enabled by default for the reranker's candidate generation only. Ordinary hybrid search keeps the no-propagation ranking. This milestone optimizes material available to the reranker, not RRF as a final ranker.

### Qwen development result

After selecting multi-branch propagation, the same local Qwen3 reranker was run against the frozen development split. Query embeddings were cached before each run so Ollama could be unloaded and the 4,096-token, one-slot llama.cpp profile could process long candidates without Metal memory exhaustion.

| Reranked candidate generation |   MRR | Recall@1 | Recall@5 | Recall@10 | Hit@10 | nDCG@10 | Candidate recall |
| ----------------------------- | ----: | -------: | -------: | --------: | -----: | ------: | ---------------: |
| no propagation                | 0.446 |    0.358 |    0.462 |     0.521 |  0.625 |   0.438 |            0.592 |
| multi-branch                  | 0.500 |    0.396 |    0.537 |     0.608 |  0.725 |   0.497 |            0.667 |

Target outcomes moved from A/B/C/D = 14/11/6/26 to 13/8/6/30. Exact symbols, migrations, and tests retained 1.0 Recall@10. Among categories with three cases, notable gains were error handling (0.333→1.0 Recall@10), database schema (0.333→0.667), cross-file (0.278→0.444), and utility (0→0.333). Feature-flow Recall@10 remained 0.333, implementation remained 0.5, authorization remained 0.167, API endpoints remained 0.5, and UI remained 0.333. These small category slices describe failures; they are not statistical claims.

Mean candidate payload decreased from 134,812 to 133,211 bytes. Mean candidate generation increased from 671.4 to 742.5 ms (+71.2 ms, 10.6%). Mean reranking changed from 39,902.7 to 38,638.1 ms (-3.2%), which is run/load noise rather than an algorithmic reranker speedup because candidate count stayed at 50.

### Held-out result

The 15-case held-out split was evaluated once after the multi-branch method and bounds were fixed. Because it contains only one case per category, only aggregate metrics are reported.

| Strategy      |   MRR | Recall@1 | Recall@5 | Recall@10 | Hit@10 | nDCG@10 | Candidate recall |
| ------------- | ----: | -------: | -------: | --------: | -----: | ------: | ---------------: |
| dense         | 0.492 |    0.289 |    0.506 |     0.561 |  0.800 |   0.489 |                — |
| lexical       | 0.062 |    0.000 |    0.067 |     0.222 |  0.267 |   0.090 |                — |
| structured    | 0.067 |    0.067 |    0.067 |     0.067 |  0.067 |   0.067 |                — |
| hybrid        | 0.282 |    0.117 |    0.250 |     0.406 |  0.533 |   0.286 |                — |
| hybrid+rerank | 0.568 |    0.333 |    0.622 |     0.711 |  0.867 |   0.581 |            0.767 |

The held-out reranker pool contained 50 candidates averaging 143,586 bytes. Mean generation was 714.5 ms and mean reranking was 39,258.4 ms. Target outcomes were A/B/C/D = 5/3/2/16. The historical commit target was returned at rank 2 under its cutoff. Important misses remained both authorization symbols in one workspace access file, the workflow schema, two of three offline-retry flow symbols, and one upload-permission collaborator. These results are reported as-is and were not used to revise the selected approach.

### Original smoke regression

The unchanged 11-case smoke suite was rerun after selection. Dense, lexical, and direct hybrid results are unchanged because file propagation is scoped to the reranker pool. Structured is now independently reported. The reranked smoke result regressed slightly despite the development and held-out gains.

| Strategy      |   MRR | Recall@5 | Recall@10 | Hit@10 | nDCG@10 |
| ------------- | ----: | -------: | --------: | -----: | ------: |
| dense         | 0.561 |    0.576 |     0.576 |  0.727 |   0.477 |
| lexical       | 0.091 |    0.273 |     0.273 |  0.273 |   0.136 |
| structured    | 0.348 |    0.409 |     0.409 |  0.455 |   0.358 |
| hybrid        | 0.405 |    0.500 |     0.545 |  0.636 |   0.433 |
| hybrid+rerank | 0.642 |    0.621 |     0.758 |  0.909 |   0.618 |

Compared with Candidate Generation v2's reranked smoke baseline, MRR moved 0.652→0.642, Recall@5 0.697→0.621, Recall@10 0.788→0.758, and nDCG@10 0.629→0.618; Hit@10 stayed 0.909 and candidate recall stayed 0.833. This is the main observed regression and reinforces why ranking decisions were based on the larger development split rather than the smoke fixture.

The motivating unauthorized-request case is not solved. Multi-branch propagation now promotes representative `apiWrapper` chunks to fused ranks 26–27, but Qwen still places the file below top 10; `authenticate-request.ts` remains absent because no bounded raw branch retrieved one of its chunks. The next bottleneck is therefore bounded structural/relationship expansion for collaborating symbols and files, followed by reranker discrimination—not a stronger unbounded file aggregate.

## Structural relationship evaluation

The bounded structural relationship milestone compared the unchanged multi-branch 50-candidate pool with one-hop expansion on the 40-case development split. An order-preserving deterministic reranker exposed the exact pool without spending model time during parameter selection.

| Development configuration |   MRR | Recall@5 | Recall@10 | Hit@10 | nDCG@10 | Candidate recall |   A |   B |   C |   D | Generation |
| ------------------------- | ----: | -------: | --------: | -----: | ------: | ---------------: | --: | --: | --: | --: | ---------: |
| file evidence baseline    | 0.342 |    0.388 |     0.454 |  0.550 |   0.348 |            0.667 |  13 |   8 |  13 |  23 |   760.6 ms |
| + bounded relationships   | 0.347 |    0.425 |     0.467 |  0.575 |   0.358 |            0.675 |  11 |   9 |  13 |  24 |   950.8 ms |

Two targets entered the pool that were absent from the baseline pool: the AI survey-generation `POST` route at candidate rank 41 and `apps/web/lib/env.ts` for object-storage configuration at rank 48. Only the latter was relationship-only; the route also existed in a raw branch outside the baseline selected pool. One directly retrieved `apps/web/lib/env.ts` target for BullMQ configuration was displaced from baseline candidate rank 49. Exact-symbol, migration, and test candidate recall remained 1.0.

The relationship-only pool contained 140 candidates across the run; one matched an authored target and 139 did not. Those are corpus-relative false positives—labels are intentionally sparse—but the ratio and the marginal net candidate gain do not justify enabling expansion by default. The experimental stage therefore remains available through `--relationship-expansion bounded` while the normal direct and reranked defaults remain `none`.

Mean candidate generation increased by 190.1 ms (25.0%) but remained below one second and small relative to the roughly 39-second local reranker. The motivating `authenticate-request.ts` target was absent from every raw branch and entered the 50-candidate pool at rank 48 through a direct `IMPORTS` edge from retrieved API-wrapper/authentication evidence.

After the architecture, relationship types, anchor policy, and budgets were frozen, live Qwen3 reranking used the required 8K llama.cpp context. Query embeddings were computed once and Ollama's model was unloaded before reranking to keep both models from exceeding a 16 GB machine. Qwen scores were cached by query and chunk identity so candidates shared by the baseline and enabled pools were not reranked twice. The live baseline exactly reproduced the previously recorded baseline, validating this resource-safe execution method.

| Live development configuration |   MRR | Recall@5 | Recall@10 | Hit@10 | nDCG@10 | Candidate recall |   A |   B |   C |   D | Generation |
| ------------------------------ | ----: | -------: | --------: | -----: | ------: | ---------------: | --: | --: | --: | --: | ---------: |
| file evidence baseline         | 0.500 |    0.537 |     0.608 |  0.725 |   0.497 |            0.667 |  13 |   8 |   6 |  30 |   648.5 ms |
| + bounded relationships        | 0.500 |    0.546 |     0.617 |  0.725 |   0.503 |            0.675 |  11 |   9 |   6 |  31 |   770.8 ms |

The AI survey-generation `POST` target entered at candidate rank 41 and Qwen promoted it to final rank 4. It was not strictly relationship-only because a direct branch had retrieved it outside the baseline's selected pool. The object-storage `apps/web/lib/env.ts` target was the one strict relationship-only recovery at candidate rank 48 and stayed below top 10. A directly retrieved BullMQ `apps/web/lib/env.ts` target at baseline candidate rank 49 was displaced. Feature-flow Recall@10 improved from 0.333 to 0.444; configuration's recovery and displacement canceled. Exact-symbol, migration, and test Recall@10 and candidate recall remained 1.0. No development category's final metrics declined.

Live development candidate generation increased by 122.3 ms (18.9%). Reranking time is not compared between the two rows because the enabled run intentionally reused identical Qwen scores from the baseline.

The sealed 15-case held-out split was evaluated once after development selection, with no subsequent architecture or parameter changes:

| Live held-out configuration |   MRR | Recall@5 | Recall@10 | Hit@10 | nDCG@10 | Candidate recall |   A |   B |   C |   D | Generation |
| --------------------------- | ----: | -------: | --------: | -----: | ------: | ---------------: | --: | --: | --: | --: | ---------: |
| file evidence baseline      | 0.568 |    0.622 |     0.711 |  0.867 |   0.581 |            0.767 |   5 |   3 |   2 |  16 |   746.6 ms |
| + bounded relationships     | 0.568 |    0.622 |     0.711 |  0.867 |   0.581 |            0.789 |   4 |   3 |   3 |  16 |   977.0 ms |

The SMTP configuration `apps/web/lib/env.ts` target entered only through a relationship at candidate rank 48 and was reranked below top 10. No authored target was displaced, and final metrics were unchanged. Held-out candidate generation increased by 230.4 ms (30.9%). The 54 relationship-only held-out candidates contained one authored target and 53 corpus-relative false positives.

These results preserve the development decision: bounded relationships demonstrably reduce failure class A, but the marginal recall gain and predominantly unlabeled expansion candidates do not justify enabling the feature by default. The next bottleneck is relationship precision and reranker discrimination, evaluated on a larger corpus rather than by tuning against this held-out split.

## Deterministic query intent and source-role evaluation

The intent taxonomy, conservative role classifier, rank-only fusion mechanism, `0.75` compatibility threshold, and three candidate settings were fixed using only the 40-case development split. An order-preserving diagnostic reranker exposed the exact default multi-branch 50-candidate pool, so this selection compared candidate ordering and coverage without using Qwen scores as a tuning signal.

| Intent-role setting | Weight |   MRR | Recall@1 | Recall@5 | Recall@10 | Hit@10 | nDCG@10 | Candidate recall | Mean bytes | Generation |
| ------------------- | -----: | ----: | -------: | -------: | --------: | -----: | ------: | ---------------: | ---------: | ---------: |
| none                |    0.0 | 0.342 |    0.233 |    0.388 |     0.454 |  0.550 |   0.348 |            0.667 |    133,211 |   613.3 ms |
| weak                |    0.2 | 0.380 |    0.271 |    0.421 |     0.467 |  0.575 |   0.379 |            0.667 |    130,804 |   598.0 ms |
| moderate            |    0.5 | 0.403 |    0.296 |    0.421 |     0.533 |  0.650 |   0.410 |            0.667 |    129,389 |   606.4 ms |

`weak` is the selected default despite the larger moderate gain: it is the smallest bounded signal with useful improvements in every aggregate ranking metric and no candidate-recall regression. The single-run timing differences are measurement noise, not claimed speedups or slowdowns; every setting stayed within 15.3 ms of the baseline against an existing roughly 600–1000 ms pipeline. Candidate count remained fixed at 50.

On categories with three or more development cases, weak versus none improved API endpoint MRR from 0.208 to 0.448 and Recall@5 from 0.167 to 0.500; database-schema MRR from 0.167 to 0.333 and Recall@1 from 0 to 0.333; implementation MRR from 0.222 to 0.278; feature-flow Recall@5 from 0.333 to 0.444; and repository-infrastructure MRR from 0.100 to 0.125. Configuration changed from a complete top-10 miss to Recall@10 0.167. Exact-symbol, test, and migration Recall@10 remained 1.0. No development category metric declined in this order-preserving comparison. These three-case slices are failure-analysis evidence, not statistical claims.

The selected architecture and weight were frozen after this comparison. The compatibility branch preserves the pre-prior order of all eligible roles so multi-intent queries can prefer both, for example, configuration and implementation evidence without forcing one exclusive source class. Relationship expansion remains independent and disabled by default.

### Live Qwen development result

After selection, the weak default was compared with the exact pre-change Qwen baseline under the same default 50-candidate, multi-branch, no-relationship pipeline and an 8K one-slot llama.cpp profile:

| Live development configuration |   MRR | Recall@1 | Recall@5 | Recall@10 | Hit@10 | nDCG@10 | Candidate recall |   A |   B |   C |   D |
| ------------------------------ | ----: | -------: | -------: | --------: | -----: | ------: | ---------------: | --: | --: | --: | --: |
| no intent-role prior           | 0.500 |    0.396 |    0.537 |     0.608 |  0.725 |   0.497 |            0.667 |  13 |   8 |   6 |  30 |
| weak intent-role prior         | 0.500 |    0.396 |    0.537 |     0.621 |  0.725 |   0.499 |            0.667 |  13 |   8 |   5 |  31 |

The exact MRR change was 0.50045→0.50010 (−0.00035); nDCG@10 changed 0.49708→0.49933. Configuration Recall@10 improved from 0.500 to 0.667 and its nDCG@10 from 0.213 to 0.246. The only material category movement in the other direction was a small API-endpoint MRR/nDCG change from 0.375/0.416 to 0.370/0.412; its recall at every reported cutoff was unchanged. Exact-symbol, migration, and test metrics remained 1.0 throughout. Broad `general` queries received zero role compatibility and were not narrowed.

The diagnostics show the interaction boundary clearly. The webhook-creation implementation moved from fused rank 3 to candidate rank 2, but Qwen placed it at final rank 4 behind a superficial webhook test and documentation. The CI unit-test workflow moved 10→8 in the candidate pool and Qwen promoted the correct configuration to final rank 1 while retaining test/configuration as simultaneous intents. A Prisma response/contact target moved 2→1 before reranking. Conversely, Qwen moved the relevant public-response route from candidate rank 3 below the top-10 cutoff, which is reported as `reranker_reversed_useful_order`. Exact symbol targets stayed at candidate and final rank 1.

Mean candidate payload decreased from 133,211 to 130,804 bytes. Live candidate generation measured 818.0 ms before and 636.1 ms after, but the paired deterministic run measured only −15.3 ms; both differences are treated as runtime noise rather than an algorithmic speedup. The added work is bounded in-memory string/metadata classification with no model, scan, or query. Mean reranking was 25,806.6 ms before and 27,283.0 ms after, also runtime noise because the reranker and candidate bound are unchanged.

### Sealed held-out result

After the taxonomy, threshold, fusion mechanism, and weak weight were frozen, the 15-case held-out split was opened for exactly one direct benchmark and one Qwen-reranked benchmark. No implementation or parameter was changed afterward. Because every category has one case, category aggregates are not interpreted as general results.

| Held-out configuration |   MRR | Recall@1 | Recall@5 | Recall@10 | Hit@10 | nDCG@10 | Candidate recall |
| ---------------------- | ----: | -------: | -------: | --------: | -----: | ------: | ---------------: |
| direct baseline        | 0.282 |    0.117 |    0.250 |     0.406 |  0.533 |   0.286 |                — |
| direct weak prior      | 0.296 |    0.117 |    0.283 |     0.472 |  0.600 |   0.311 |                — |
| Qwen baseline          | 0.568 |    0.333 |    0.622 |     0.711 |  0.867 |   0.581 |            0.767 |
| Qwen weak prior        | 0.568 |    0.333 |    0.656 |     0.711 |  0.867 |   0.582 |            0.767 |

The weak reranked pool averaged 141,497 bytes, candidate generation 658.2 ms, and reranking 28,722.1 ms. Outcomes remained A/B/C/D = 5/3/2/16. The workflow-foundation migration is the clearest role-aware recovery: it moved from pre-prior rank 22 to candidate rank 9 and Qwen returned it first. The file-upload implementation moved 10→7 and finished second. Exact-symbol, test, and migration cases remained final rank 1.

The sealed split also exposed limitations left unchanged. The OAuth write-authorization query emitted only `general`, so it received no role prior and missed both labeled symbols even though the target file was present. The workflow schema remained absent, and two offline-response flow symbols remained absent. Qwen continued to put a superficial test above the correct feedback-token route and put storage tests above the cross-file upload collaborators. These results suggest the next bottleneck is candidate/symbol coverage plus reranker discrimination; expanding the deterministic vocabulary from one held-out query would be overfitting.
