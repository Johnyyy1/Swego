# Evidence Packs

## Purpose and boundary

Evidence Pack v1 turns a few strong retrieval results into a compact, structured context package for a coding agent. It is a consumer of repository-memory retrieval, not a fourth retrieval branch: `swega search` continues to return ranked chunks, while `swega context` calls the same search API and then performs bounded context assembly.

```text
query
  -> hybrid retrieval and optional reranking
  -> 2-5 diverse anchors (default 5)
  -> bounded local and one-hop structural support
  -> provenance-preserving deduplication and budgeting
  -> Evidence Pack
```

The builder lives in `@swega/retrieval` so future MCP or API adapters can call it without invoking CLI code. It performs no repository scan, source parsing, embedding generation, recursive traversal, generative model call, or LLM summarization. The CLI, `@swega/evaluation`, and future delivery adapters remain consumers of this package-level API.

## Public model

`EvidencePack` is a versioned structured object. Schema version 1 includes:

- repository identity: SWEGA repository UUID plus provider, owner, name, URL, and default branch;
- query, exact resolved cutoff, selected source revisions, and deterministic query-intent signals;
- ordered evidence items with context role, inclusion reasons, source role, stable source reference, timestamps, path, revision, line range, language, structural symbol metadata, compact retrieval provenance, relationship provenance, and faithful source content;
- maximum, used, and remaining content characters; a deterministic four-characters-per-token estimate; truncation and rejection counts;
- optional debug decisions and search/expansion/total timings.

Internal document and chunk IDs drive safe lookup and deduplication but are not required public semantics in the pack. Stable paths, source references, commit SHAs, timestamps, and structural metadata provide public provenance.

Normal public output retains final evidence rank and exact-symbol status but omits dense/lexical/structured/RRF/reranker ranks. Those detailed ranks remain available only with explicit debug output; raw scores are never added to the Evidence Pack contract. See [Agent Context API](agent-context-api.md) for external compatibility semantics.

The context-role taxonomy is deliberately small:

| Context role                | Meaning                                                     |
| --------------------------- | ----------------------------------------------------------- |
| `PRIMARY`                   | Primary implementation or otherwise general anchor evidence |
| `SUPPORTING_IMPLEMENTATION` | Related implementation not represented by a narrower role   |
| `TYPE_OR_INTERFACE`         | Type, interface, enum, or declaration evidence              |
| `CALLER`                    | Direct importing caller                                     |
| `DEPENDENCY`                | Direct import or re-export target                           |
| `CONFIGURATION`             | Configuration evidence                                      |
| `TEST`                      | Unit, integration, or end-to-end test evidence              |
| `SCHEMA`                    | Database schema or migration evidence                       |
| `HISTORY`                   | Issue, PR, review, comment, or commit evidence              |
| `LOCAL_CONTEXT`             | Same-symbol, parent, or adjacent structural context         |

Context role and source role are separate. A retrieved integration test can have `sourceRole: integration_test`, `contextRole: TEST`, and `reason: retrieved_primary` simultaneously. Anchor identity is therefore represented by provenance rather than forced into the `PRIMARY` role.

## Anchor policy

The builder requests a bounded final retrieval set and selects at most five anchors by default. Selection is deterministic and uses only final retrieval output:

1. exact structural matches first;
2. modest intent/source-role compatibility (tests for test intent, configuration for configuration intent, schema/migration for data intent, implementation for endpoint or implementation intent, and development history for history intent);
3. final retrieval order;
4. stable chunk identity for otherwise equal evidence.

One anchor per path and one per structural symbol prevent near-duplicate chunks from spending the anchor budget. Identical content is also rejected. These are diversity constraints, not quotas: stronger evidence still wins. `--limit` controls the anchor count from 1 through 5 for `context`; it retains its existing meaning for `search`.

Development comparison used only the context corpus and the same 30,000-character budget:

| Anchors | Required recall | Supporting recall | Complete packs | Precision | Noise | Budget use |
| ------: | --------------: | ----------------: | -------------: | --------: | ----: | ---------: |
|       2 |           0.440 |             0.320 |          0.200 |     0.269 | 0.731 |      0.312 |
|       3 |           0.533 |             0.320 |          0.320 |     0.207 | 0.793 |      0.444 |
|       4 |           0.593 |             0.420 |          0.360 |     0.180 | 0.820 |      0.597 |
|       5 |           0.633 |             0.420 |          0.440 |     0.153 | 0.847 |      0.696 |

Five anchors were frozen because required-evidence recall and complete-pack rate are the primary objectives, the extra anchor improved both over four, and the pack remained inside the fixed budget with better precision/noise than raw top-K. Two anchors remain a more compact high-precision option.

## Structural expansion

Local expansion reads all anchor rows in one query and all eligible local chunks in one subsequent query. Per anchor it keeps at most two candidates, ordered as:

1. another part of the same structural symbol;
2. the containing parent declaration;
3. an immediately adjacent structural chunk;
4. an adjacent fallback text chunk when structural metadata is unavailable.

This operates on stored chunk boundaries. It does not fetch arbitrary `+/- N` lines or return whole files. Adjacent fallback chunks retain repository-memory's existing 120-line/12,000-character bound.

Cross-file expansion reuses `source_relationships` through the existing `RelationshipExpansion` interface. It traverses depth exactly one, with at most two neighbors per anchor and at most ten relationship candidates for the five-anchor default. Stored `IMPORTS` and `REEXPORTS` plus the query-time `IMPORTED_BY` inverse support relative and statically configured local dependencies, re-export targets, callers, and representative tests when a test directly imports an anchor. Type/configuration/schema/test roles are classified from stored metadata; no semantic caller, inferred test counterpart, package-manager resolution, or schema relationship is invented.

An `exact_symbol` relationship selects its verified structural target before lexical/query heuristics. An `exact_module` relationship retains the prior representative-chunk fallback. JSON provenance distinguishes `imports_symbol` from `imports_module` and preserves imported/local/exposed names, binding/type-only state, module-resolution kind, target kind/range, and config path/revision. These are backward-compatible additions, so Evidence Pack schema version remains `1`.

Candidate-generation relationship expansion and context expansion remain separate consumers of the same graph. The former asks whether a neighbor should enter a retrieval pool and remains search-default-off; the latter asks what one-hop evidence helps explain an already strong anchor and is context-default-on. `--relationship-expansion none` disables the context use explicitly.

## Intent behavior

Intent changes preferences without creating a large policy matrix:

- implementation and endpoint intent prefer production anchors, then local declarations, direct dependencies/callers, types, and later tests;
- test intent prefers tests as anchors and production code under test as related evidence;
- configuration intent prefers configuration anchors and directly importing consumers;
- database/schema and migration intent prefer schema or migration anchors before consumers;
- exact-symbol intent protects exact structural matches and only expands local or direct one-hop evidence;
- history/rationale intent prefers development-history anchors and disables current-source structural expansion rather than presenting current dependencies as historical rationale;
- general intent retains final retrieval order and bounded diversity.

No candidate is removed from retrieval and existing search ranking is unchanged.

## Temporal and repository safety

The builder resolves one cutoff and passes it unchanged to search, local expansion, and relationship expansion. Both context PostgreSQL queries apply:

```sql
repository_id = :repository_id
and available_at <= :before
and (superseded_at is null or superseded_at > :before)
```

Relationship expansion independently filters both the edge and returned neighbor chunk under the same repository and interval. Alias-derived edge availability is the maximum of source, target, and every local config snapshot used during indexing. The builder then rejects any returned item whose repository differs or whose availability is after the cutoff. It never falls back to a current graph or future config for a historical cutoff. Selected commit SHAs are exposed as `revisions`; different source entities may legitimately contribute different revisions.

## Budget and ordering

The default budget is 30,000 Unicode characters (`--context-budget`). Content characters, rather than encoded bytes or a provider tokenizer, are counted deterministically; estimated tokens are reported as `ceil(characters / 4)` and are explicitly an estimate.

All anchors are admitted first in deterministic anchor order. When the anchors collectively exceed the budget, each receives a fair share of remaining characters and is truncated at a line boundary when possible, with an explicit marker. Truncation iterates Unicode code points and cannot split UTF-8 data. Supporting items are never partially sliced: they are considered in intent-aware priority order with path/context-role diversity and rejected whole if they do not fit. Thus budget enforcement selects evidence rather than truncating one concatenated blob.

The default priority is primary evidence, same-symbol/parent/local context, useful implementation/type/configuration/schema dependencies, callers, representative tests, and lower-value relationship evidence. Intent adjusts the middle of that order. Final `order` is stable.

## Deduplication

The assembler removes identical chunk IDs and identical content, merges reasons and relationship provenance reached through repeated paths, and merges compatible overlapping line ranges only when they describe the same structural identity and overlapping source lines agree exactly. Distinct symbols in one file remain distinct. This prevents repeated evidence without flattening unrelated declarations.

Debug decisions expose anchor selection/rejection, inclusion priority, cumulative budget consumption, whole-item budget rejection, truncation, and deduplication/merge reasons.

## CLI

```bash
swega context <repository-id> "query"
swega context <repository-id> "query" --before 2025-03-15 --context-budget 30000
swega context <repository-id> "query" --limit 3 --relationship-expansion none
swega context <repository-id> "query" --rerank --debug
swega context <repository-id> "query" --json
```

Human output groups role, location, source role, retrieval/relationship provenance, reason, and faithful content. `--json` emits the complete schema-versioned pack. `--debug` adds decisions and timings to either representation. Optional reranking uses the existing provider-neutral local reranker; no summarizer is introduced.

## Development evaluation

[`formbricks-context-development.json`](../benchmarks/formbricks-context-development.json) contains 25 manually reviewable tasks across implementation, exact navigation, feature flows, configuration, endpoints, authorization, database/schema, migrations, error handling, tests, UI, utilities, and cross-file behavior. Required and supporting targets were authored by inspecting Formbricks commit `88a38c081fc7536a4edf74f8b03f9cf9ce4ee2d5` directly.

The alias/exact-symbol held-out corpus was authored from direct `git show`, `git grep`, and `git ls-tree` inspection of that revision without consulting SWEGA rankings. Thirteen realistic tasks were frozen before implementation in [`formbricks-context-held-out.json`](../benchmarks/formbricks-context-held-out.json); the adjacent SHA-256 file seals its bytes. The schema requires 10–15 held-out cases plus author, review count, and sealing timestamp. It is a single-author, single-reviewer directional evaluation, not a statistical generalization claim.

Run the fair same-budget comparison with:

```bash
swega context-benchmark benchmarks/formbricks-context-development.json
swega context-benchmark benchmarks/formbricks-context-development.json --json
```

The baseline takes ordinary ranked chunks until the same 30,000-character budget is exhausted. Evidence Pack uses the frozen five anchors, depth-one expansion, two local and two relationship neighbors per anchor, and the same budget. Metrics are separately reported rather than combined into an opaque score:

- required and supporting evidence recall;
- complete-pack/task coverage;
- evidence precision and noise ratio;
- duplicate content/overlap ratio;
- budget utilization and payload characters;
- distinct relevant files;
- search, context-expansion, and total latency.
- relationship-derived labeled precision, exact-target landing rate, and module-only fallback rate. These use relationship-derived items as the unit; an exact landing additionally requires a symbol-bearing edge whose verified target equals the selected structural symbol. Unlabeled items are not claimed universally irrelevant.

The recorded pre-alias non-reranked development run produced:

| Strategy      | Required | Supporting | Complete | Precision | Duplicate | Noise | Relevant files |  Chars | Budget |   Search | Expansion |    Total |
| ------------- | -------: | ---------: | -------: | --------: | --------: | ----: | -------------: | -----: | -----: | -------: | --------: | -------: |
| raw top-K     |    0.413 |      0.320 |    0.160 |     0.104 |     0.015 | 0.896 |           0.92 | 30,000 |  1.000 | 704.2 ms |    0.0 ms | 704.2 ms |
| Evidence Pack |    0.633 |      0.420 |    0.440 |     0.153 |     0.000 | 0.847 |           1.32 | 20,880 |  0.696 | 674.0 ms |  121.0 ms | 795.3 ms |

Evidence Pack improved required recall by 0.220, supporting recall by 0.100, complete-pack rate by 0.280, and precision by 0.049 while eliminating observed duplicates and reducing noise by 0.049. Average selected content was approximately 20,880 characters, or an estimated 5,220 tokens. Context assembly added 121.0 ms on the measured local/database setup; search timings vary independently because the two strategies execute separately and are not treated as an algorithmic change.

Category-level required-recall gains were strongest for utilities (+0.750), cross-file tasks (+0.500), implementation (+0.500), and +0.250 for endpoints, authorization, configuration, database/schema, and UI. Exact-symbol, error-handling, migration, test, and feature-flow required recall did not regress; their gains were zero in this small split. This is the recorded pre-alias baseline.

The frozen alias/exact-symbol milestone results, including the sole sealed held-out run, relationship
resolution rates, category regressions, latency, and environment limitations, are reported in
[`formbricks-context-alias-symbol-report.md`](../benchmarks/formbricks-context-alias-symbol-report.md).

These numbers characterize one repository and one author-reviewed development set. They are evidence for the selected v1 defaults, not a general benchmark claim.

## Limitations

- Relationship support is limited to the documented relative/tsconfig/jsconfig local subset. Package-manager/workspace resolution, package-valued config inheritance, semantic call graphs, inferred test matching, and schema/reference resolution remain unsupported.
- Local context is only as precise as stored structural chunks; unsupported languages use one adjacent bounded fallback chunk.
- Five anchors trade some precision and budget headroom for materially better complete-pack coverage than two through four anchors on the development set.
- Source snapshots must already exist at a historical cutoff; v1 does not reconstruct a missing Git tree or relationship graph at query time.
- The pack contains faithful evidence, not an explanation or generated summary.
- The development and sealed context held-out evaluations have no independent reviewer.
