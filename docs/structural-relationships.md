# Structural relationship expansion

## Purpose

Structural relationship expansion is a bounded candidate-recall stage. It asks which directly connected code should become eligible after SWEGA has already found a strong file or symbol. It is not semantic retrieval, arbitrary graph search, or final context expansion.

## Relationship taxonomy

| Relationship                                 | v1 status              | Reliability and provenance                                                                                                                                       |
| -------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IMPORTS`                                    | Stored                 | A TypeScript-family `import` with a relative module specifier resolved to an admitted indexed file. Named/default bindings and the statement line are preserved. |
| `IMPORTED_BY`                                | Query-time inverse     | The reverse of a stored `IMPORTS` edge. It has the same static provenance and is not stored twice.                                                               |
| `REEXPORTS`                                  | Stored                 | A TypeScript-family `export ... from` with a relative module specifier resolved to an admitted indexed file. Named aliases are preserved.                        |
| `SAME_FILE` / `PARENT_SYMBOL`                | Existing metadata only | Chunk metadata already identifies file and structural parents. v1 does not turn these into graph edges.                                                          |
| symbol references, caller/callee, type usage | Deferred               | Syntax-only parsing cannot resolve these reliably across files without project/module/type analysis.                                                             |
| test counterpart                             | Deferred               | Filename conventions are an inference and are not reliable enough for the high-precision v1 graph.                                                               |

External packages, unresolved relative imports, and configured package/path aliases are not represented. An absent edge means unknown, not unrelated.

## Language and extraction architecture

`@swega/documents` defines a generic `SourceRelationshipExtractor`. The initial adapter uses the TypeScript compiler syntax tree for `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, and `.cjs`. Unsupported or malformed files keep their existing chunks and retrieval behavior with no fabricated edges.

During `build-memory`, admitted file contents are already read from Git. The relationship adapter inspects that same bounded text, resolves relative specifiers against the admitted repository-memory path set, and emits deterministic relationships. It does not load a `tsconfig`, scan the filesystem, type-check, install dependencies, or execute repository code. Git ingestion remains independent. Rebuilding memory reconciles the complete current relationship projection.

## Derived data model

`source_relationships` is a rebuildable PostgreSQL projection. Every row has a deterministic ID and records repository, source and target document IDs, type, source and target paths/symbols, language, source and target commit SHAs, availability interval, parser provenance, source line, reason, and static confidence. Composite foreign keys to source and target documents enforce repository isolation; cascading document deletion removes stale edges. Source/target indexes make traversal a bounded database lookup rather than query-time parsing.

The table is preferable to chunk metadata because one edge connects two versioned documents and needs reverse lookup. It is preferable to repository-file source data because relationships are parser-derived and rebuildable.

## Temporal semantics

An edge becomes available at the later availability time of its source and target documents. Retrieval filters the edge and the representative neighbor chunk with the same repository and interval predicate used by the three direct branches. Thus an import introduced after cutoff `T` cannot be traversed at `T`.

Current source-code memory represents the indexed default-branch snapshot rather than every historic tree. SWEGA therefore expands only relationships backed by source documents valid at the cutoff. It does not reconstruct a missing historical graph or fall back to the current graph. For an older cutoff without a retained source snapshot, structural expansion yields no candidate.

## Bounded candidate generation

The selected defaults are:

- depth exactly 1;
- at most 12 strong anchors;
- at most 3 distinct neighbor documents per anchor;
- at most 16 relationship candidates;
- at most 4 reserved slots for the highest-ranked relationship-only candidates inside the fixed pool;
- one representative chunk per ranked relationship neighbor;
- the existing final pool remains 50 candidates with two chunks per path.

Anchors must have an exact structural match, agreement from at least two direct branches, multi-branch file evidence, or a fused rank in the first five. Relationship-only candidates are never promoted to anchors in the same query.

Neighbors form a separate rank-only RRF branch. `IMPORTS` precedes `REEXPORTS`, which precedes the potentially broader `IMPORTED_BY` inverse; raw relationship values are never added to cosine, full-text, or structural scores. The four-slot reservation ensures high-confidence relationship-only evidence is actually eligible when ordinary four-way RRF would cut it below 50, while exact-symbol candidates remain protected. Within a neighbor, representative selection prefers the exact imported/re-exported symbol, then query/symbol overlap and implementation-bearing declarations, with stable chunk identity as the final tie-breaker. Whole files are never inserted.

The production reranker flow is:

```text
dense + lexical + structured
  -> branch diversification
  -> RRF + multi-branch file evidence
  -> strong anchors
  -> bounded one-hop relationship candidates
  -> rank-only relationship fusion
  -> final path diversification
  -> 50-candidate reranker pool
```

Relationship expansion remains disabled by default for both ordinary and reranked search. The development candidate diagnostic found a small net coverage gain but predominantly unlabeled relationship-only candidates, so `--relationship-expansion bounded` is an explicit experimental opt-in rather than a production default.

## Diagnostics

Debug results identify the relationship type, source path/symbol, target path/symbol, depth, reason, rank, and whether the chunk was also retrieved directly. Benchmark diagnostics count relationship-only candidates, labeled targets recovered only by those candidates, and relationship-only candidates that match no authored target for that case. These latter counts are corpus-relative diagnostics, not universal relevance judgments.
