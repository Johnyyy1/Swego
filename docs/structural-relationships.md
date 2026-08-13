# Structural relationship expansion

## Purpose

Structural relationship expansion is a bounded candidate-recall stage. It asks which directly connected code should become eligible after SWEGA has already found a strong file or symbol. It is not semantic retrieval, arbitrary graph search, or final context expansion.

## Relationship taxonomy

| Relationship                                 | Status                 | Reliability and provenance                                                                                                                                                                 |
| -------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `IMPORTS`                                    | Stored                 | A TypeScript-family import whose relative, configured path-alias, or `baseUrl` target resolves to exactly one admitted repository file. Binding kind, names, and type-only status persist. |
| `IMPORTED_BY`                                | Query-time inverse     | The module-level reverse of a stored `IMPORTS` edge. It has the same static config/binding provenance and is not stored twice.                                                             |
| `REEXPORTS`                                  | Stored                 | A TypeScript-family `export ... from` with preserved imported and exposed names. Named/default targets can be exact symbols; namespace and export-star targets stay module-only.           |
| `SAME_FILE` / `PARENT_SYMBOL`                | Existing metadata only | Chunk metadata already identifies file and structural parents. They are not graph edges.                                                                                                   |
| symbol references, caller/callee, type usage | Deferred               | This projection does not create call, usage, inheritance, or dataflow edges.                                                                                                               |
| test counterpart                             | Deferred               | Filename conventions are an inference and are not reliable enough for the high-precision graph.                                                                                            |

External packages and unresolved or ambiguous local modules are not represented. An absent edge means unknown, not unrelated.

## Language and extraction architecture

`@swega/documents` defines a generic `SourceRelationshipExtractor`. The TypeScript adapter uses the compiler syntax tree for `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, and `.cjs`. Unsupported or malformed files keep their existing chunks and retrieval behavior with no fabricated edges.

During `build-memory`, admitted file contents are already read from Git. The relationship adapter inspects that same bounded in-memory text and path set. It parses supported source and project configs once per memory build; there is no query-time config parsing, filesystem scan, type-check, dependency installation, or repository-code execution. Git ingestion remains independent. Rebuilding memory reconciles the complete current relationship projection.

## Supported project-resolution subset

For each source file the resolver selects the closest ancestor `tsconfig.json`, preferring it to a same-directory `jsconfig.json`. It statically reads JSONC and supports:

- string-valued local relative `extends`, with `.json` fallback;
- inherited `compilerOptions.baseUrl` and `compilerOptions.paths`;
- exact path keys and keys with one `*`, using the most-specific matching key;
- ordered target substitutions, repository-relative normalization, the supported TypeScript-family extensions, JavaScript-specifier-to-TypeScript fallback, and directory `index` forms.

Config cycles, malformed configs, missing local parents, absolute paths, and paths that escape the repository fail closed. A child config's explicit safe settings may still be used when an unsupported parent cannot be loaded. Package-valued `extends`, workspace-package manifests, `package.json` exports/imports, Node module lookup, `rootDirs`, and compiler plugins are not resolved in this version. A workspace package is local only when an applicable `paths`/`baseUrl` mapping identifies an admitted file; SWEGA does not implement a package-manager resolver.

If multiple configured substitutions resolve to different admitted paths, no edge is emitted. Within one path, extension and file-before-directory ordering is the documented bounded resolver order rather than an ambiguity. Bare names that miss `baseUrl` are treated as possible external packages, not asserted to be unresolved local imports.

## Binding and exact-target semantics

Each edge preserves `importedName`, `localName`, `exposedName`, `bindingKind`, and `isTypeOnly`. Named and renamed imports keep the exported name distinct from the local alias. Default imports use imported name `default`; namespace and side-effect imports have no invented target symbol. Named/default re-exports keep the incoming and publicly exposed names distinct, while `export *` stays module-only.

Existing structural chunks are the definition index. A target is `exact_symbol` only when one local export mapping leads to one top-level structural symbol identity. The row then preserves its symbol name, kind, and full line range. Missing exports, duplicate declarations, anonymous default expressions without a structural declaration, namespace imports, side effects, and export-star edges are `exact_module`; target-symbol fields are null. `unresolved` and `ambiguous` are extraction diagnostics and are never persisted as traversable edges. Static persisted edges retain confidence `1`; the discrete resolution state carries the useful precision distinction.

## Derived data model

`source_relationships` is a rebuildable PostgreSQL projection. Every row has a deterministic ID and records repository, source and target document IDs, relationship/binding/module-resolution kinds, imported/local/exposed names, type-only status, exact target metadata when verified, config path/revision when applicable, source and target revisions, availability interval, parser provenance, source line, reason, and static confidence. Composite foreign keys to source and target documents enforce repository isolation; cascading document deletion removes stale edges. Source/target indexes make traversal a bounded database lookup rather than query-time parsing.

The table is preferable to chunk metadata because one edge connects two versioned documents and needs reverse lookup. It is preferable to repository-file source data because relationships are parser-derived and rebuildable.

## Temporal semantics

An edge becomes available at the latest availability time of its source document, target document, and every indexed local config document used by resolution. Retrieval filters both edge and representative neighbor chunk with the same repository and interval predicates used by direct retrieval. An alias, target symbol, relationship, or local inherited config introduced after cutoff `T` therefore cannot be traversed at `T`.

Current source-code memory represents the indexed default-branch snapshot rather than every historic tree. SWEGA therefore expands only relationships backed by source/config documents valid at the cutoff. It does not reconstruct a missing historical graph or fall back to the current graph. For an older cutoff without a retained source snapshot, structural expansion yields no candidate.

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

Neighbors form a separate rank-only RRF branch. `IMPORTS` precedes `REEXPORTS`, which precedes the potentially broader `IMPORTED_BY` inverse; raw relationship values are never added to cosine, full-text, or structural scores. The four-slot reservation ensures high-confidence relationship-only evidence is eligible while exact-symbol candidates remain protected. For `exact_symbol`, the verified structural name takes absolute precedence over query overlap. For `exact_module` and the module-level `IMPORTED_BY` inverse, the prior query/symbol and implementation heuristics remain the fallback. Whole files are never inserted.

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

Relationship expansion remains disabled by default for ordinary and reranked search. The development candidate diagnostic found a small net coverage gain but predominantly unlabeled relationship-only candidates, so `--relationship-expansion bounded` remains an explicit opt-in. Evidence Pack context keeps its existing bounded-on default.

## Diagnostics

Index diagnostics count relative, alias, and successful `baseUrl` attempts; resolved, unresolved, and ambiguous local bindings; exact-symbol and module-only edges; symbol-bearing denominators; config parses/failures; and extraction latency. Evidence Pack benchmark diagnostics separately report exact-target landing rate, module-only fallback rate, and the fraction of relationship-derived items matching required/supporting labels. Unlabeled items are corpus-relative, not declared universally irrelevant.

Debug/JSON results preserve binding, resolution, target kind/range, and config provenance in addition to relationship type, source/target paths and symbols, depth, reason, rank, and direct-retrieval status. Depth remains exactly one; no re-export recursion or graph traversal is performed at query time.
