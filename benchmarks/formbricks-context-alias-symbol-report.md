# TypeScript alias and exact-symbol milestone report

Recorded on 2026-08-13 for Formbricks revision
`88a38c081fc7536a4edf74f8b03f9cf9ce4ee2d5` after the relationship architecture and
Evidence Pack parameters were frozen.

## Evaluation discipline

The 13-case held-out corpus was authored first by directly inspecting the pinned Git snapshot with
`git show`, `git grep`, and `git ls-tree`. SWEGA rankings were not consulted. The corpus records a
single author, one source review, ten realistic categories, difficulty and rationale per task, and
minimum required/supporting source evidence. It was sealed at `2026-08-13T10:04:37Z`; its adjacent
SHA-256 checksum remained valid before and after implementation.

Only the existing 25-case development corpus was used for implementation analysis. After that
analysis, all tests/checks/builds passed, the 30,000-character budget, five-anchor policy, bounded
depth-one expansion, and non-reranked production context configuration were frozen, and the sealed
corpus was evaluated exactly once. No design or ranking parameter changed after the sealed run.
During the subsequent final security audit, one implementation hardening was added to fail closed on
POSIX/Windows absolute `baseUrl` and `paths` operands. This did not affect the pinned Formbricks
projection because its configs contain no such operand. The sealed benchmark was not rerun.

The configured Neon project exceeded its transfer quota, so a live pre-change rerun was impossible.
The pre-change comparison below uses the checked-in result from `59edc97`; details and the failed
reproduction are in [the baseline record](formbricks-context-alias-symbol-baseline.md). Post-change
development and held-out runs used a fresh isolated PostgreSQL/pgvector database, the production
memory/embedding paths, the same pinned revision, and Qwen3 Embedding 0.6B. All 23,430 current chunks
had compatible 512-dimensional projections with zero stale rows before evaluation. Absolute timing
is therefore reported, but pre/post database timing is not treated as a controlled comparison.

## Architecture and supported semantics

Relationship extraction remains an index-time, rebuildable `@swega/documents` projection. It groups
files by repository, parses admitted TypeScript-family source/config text into bounded in-memory
maps, and never scans the host filesystem, executes repository configuration, installs dependencies,
or performs query-time resolution.

For each source, the resolver selects the closest ancestor `tsconfig.json` (before a same-directory
`jsconfig.json`) and statically interprets JSONC, relative local `extends`, inherited `baseUrl` and
`paths`, exact mappings, and one-wildcard mappings with exact/longest-prefix precedence. Bounded
extension, JavaScript-to-TypeScript, and directory-index candidates are supported. Cycles, malformed
or missing parents, absolute/escaping paths, and multiple differently resolved substitutions fail
closed. Package-valued config inheritance and package-manager/workspace resolution remain
unsupported; a bare `baseUrl` miss remains an external-package candidate.

Each persisted edge preserves named/default/namespace/side-effect/export-star binding kind,
imported/local/exposed names, and type-only status. An edge is `exact_symbol` only when one local
export maps to one top-level structural symbol identity; its name, kind, and full range are stored.
Namespace/side-effect/export-star edges, missing or duplicate exports, and anonymous default
expressions are explicit `exact_module` fallbacks with null symbol fields. Ambiguous and unresolved
bindings produce diagnostics but no edge. Evidence Packs give a verified forward exact target
absolute representative priority; module-level and inverse `IMPORTED_BY` traversal retain the prior
heuristic. Depth remains exactly one.

Availability is the latest timestamp of source, target, and every local config in the inheritance
chain. Retrieval independently filters the edge and representative chunk by repository and cutoff.
Composite source/target document foreign keys prevent cross-repository relationships, normalized
paths cannot escape the indexed repository, and debug/JSON provenance retains config/source/target
revisions plus binding and resolution fields.

## Projection results

Counts are binding-level because one declaration can name several independently targetable symbols.

| Measure                              |     Pre-change |     Post-change |
| ------------------------------------ | -------------: | --------------: |
| Resolved relationships               |          4,678 |          14,815 |
| `IMPORTS`                            |          4,487 |          14,546 |
| `REEXPORTS`                          |            191 |             269 |
| Relative attempts / resolved         |  4,857 / 4,678 |   4,859 / 4,690 |
| Configured alias attempts / resolved |     10,161 / 0 | 10,189 / 10,122 |
| `baseUrl` attempts / resolved        |   not measured |           3 / 3 |
| Unresolved local bindings            |            179 |             236 |
| Ambiguous local bindings             |              0 |               0 |
| Exact-symbol relationships           |   not verified |          14,427 |
| Exact-module relationships           | not classified |             388 |
| Config files / failures              |     not parsed |          16 / 0 |

Post-change local resolution was 98.43% (14,815/15,051), configured-alias success was 99.34%
(10,122/10,189), and verified exact targeting covered 97.90% of symbol-bearing relationships
(14,427/14,737). Module-only fallback was 2.62% of resolved relationships (388/14,815). Relationship
count increased by 216.7%, primarily because configured local aliases are now represented.

Production memory construction measured 652 ms for relationship extraction. A five-run source-only
median was 714.5 ms versus the recorded pre-change 579.4 ms, a 23.3% index-time increase. The full
memory build took 233.2 seconds, dominated by Git reads and persistence rather than relationship
extraction.

## Development result

The post-change raw row is a fresh environmental reference. The Evidence Pack pre-change row is the
recorded `59edc97` baseline; the post-change row is the frozen architecture.

| Strategy                          | Required | Supporting | Complete | Precision | Duplicate | Noise | Files |  Chars | Budget |   Search | Expansion |    Total |
| --------------------------------- | -------: | ---------: | -------: | --------: | --------: | ----: | ----: | -----: | -----: | -------: | --------: | -------: |
| Recorded pre-change Evidence Pack |    0.633 |      0.420 |    0.440 |     0.153 |     0.000 | 0.847 |  1.32 | 20,880 |  0.696 | 674.0 ms |  121.0 ms | 795.3 ms |
| Fresh raw top-K                   |    0.440 |      0.280 |    0.200 |     0.111 |     0.015 | 0.889 |  0.88 | 30,000 |  1.000 | 253.5 ms |    0.0 ms | 253.5 ms |
| Post-change Evidence Pack         |    0.673 |      0.460 |    0.480 |     0.146 |     0.000 | 0.854 |  1.52 | 22,876 |  0.763 | 249.5 ms |    9.3 ms | 259.0 ms |

Against the recorded pack, required recall improved by 0.040, supporting recall by 0.040,
complete-pack rate by 0.040, and relevant files by 0.20. Precision regressed by 0.007 and noise
increased by 0.007, while duplicate evidence remained zero. The fresh context-expansion stage was
9.3 ms; this database-local value is bounded but not directly comparable to the prior 121.0 ms
remote/database setup.

The development Evidence Pack selected 4.76 relationship-derived items per case. Their
corpus-relative labeled precision was 0.151 (0.72 labeled items per case), exact-target landing was
0.773 (3.68/4.76 symbol-bearing items per case), and module-only fallback was 0.227 (1.08 items per
case). Unlabeled evidence is not asserted universally irrelevant.

Categories with at least two development cases improved most in required recall for authorization
and configuration (+0.750 each), utilities (+0.750), and API endpoints, cross-file, and database
schema (+0.250 each). Feature flow improved +0.111 across three cases. Tests and UI each regressed
-0.250 required recall and -0.500 complete rate; error handling stayed at zero required recall.

Representative development behavior included:

- configured `@/` imports from an SSO recovery route now resolve `getSession` directly to
  `apps/web/modules/auth/lib/session.ts::getSession`, rather than having no local edge;
- the active-user session flow assembled both exact `getSession`/`getProxySession` definitions and
  their session-cookie dependency, reaching complete coverage where raw top-K missed `getSession`;
- exact-symbol selection preserved distinct symbols inside the same file and no longer lets query
  overlap redirect a verified forward import to a different definition;
- added inverse/module-level neighbors also introduced corpus-relative noise—for example an
  onboarding caller and several webhook collaborators were structurally valid but unlabeled;
- package/workspace imports without configured local mappings and missing/ambiguous exports remained
  intentionally unresolved or module-only rather than being guessed.

The Neon quota prevented a paired replay of pre-change per-case rankings, so this report does not
claim an observed old-pack correct-file/wrong-symbol example. That failure mode is instead covered
deterministically by the default-import and module-fallback fixtures; the development examples above
show the post-change exact targets and added noise. This keeps source inspection and tests from being
misrepresented as a historical ranking observation.

## Sealed held-out result

This table is the sole sealed run. There was no pre-change held-out opening and no post-run tuning.

| Strategy      | Required | Supporting | Complete | Precision | Duplicate | Noise | Files |  Chars | Budget |   Search | Expansion |    Total |
| ------------- | -------: | ---------: | -------: | --------: | --------: | ----: | ----: | -----: | -----: | -------: | --------: | -------: |
| Raw top-K     |    0.603 |      0.462 |    0.462 |     0.124 |     0.002 | 0.876 |  1.54 | 30,000 |  1.000 | 336.4 ms |    0.0 ms | 336.4 ms |
| Evidence Pack |    0.641 |      0.615 |    0.308 |     0.125 |     0.000 | 0.875 |  1.69 | 23,313 |  0.777 | 318.3 ms |   12.1 ms | 330.6 ms |

Evidence Pack improved required recall by 0.038, supporting recall by 0.153, precision by 0.001,
noise by 0.001, and relevant-file count by 0.15 while eliminating observed duplicates. However,
complete-pack rate regressed by 0.154: API endpoint and test cases each lost one required item, and
the two feature-flow cases averaged -0.167 required recall. Configuration gained a complete pack;
authorization, cross-file, and implementation also gained required evidence. Category counts are
mostly one and are not interpreted as general effects.

Held-out Evidence Packs selected 6.15 relationship-derived items per case. Corpus-relative labeled
precision was 0.163 (1.00 labeled item per case), exact-target landing was 0.825 (5.08/6.15
symbol-bearing items per case), and module-only fallback was 0.175 (1.08 items per case). This
supports generalization of exact structural targeting but not a claim that one-hop context assembly
universally improves task completeness.

## Validation and limitations

Validation passed with 297 tests and 676 assertions, including parser/config/import/re-export/exact
target tests and PostgreSQL-backed idempotency, temporal cutoff, future config/target, future edge,
repository isolation, relationship retrieval, Evidence Pack, and projection compatibility tests.
Workspace-wide TypeScript, ESLint, Prettier, Drizzle schema/migration validation, production Next.js
build, CLI doctor/search/context smokes, migration application, full memory build, and checksum/diff
checks also passed.

Remaining limitations are deliberate: no package-manager/workspace resolver, package-valued
`extends`, package exports/imports, `rootDirs`, compiler plugins, semantic usage/call/inheritance
graphs, recursive re-export traversal, multi-hop expansion, historical Git-tree reconstruction, or
independent corpus reviewer. Exact targeting depends on existing structural chunks and direct local
export maps; barrel-chain semantics beyond the stored one-hop re-export remain module-level or
unresolved. The single repository and small manually labeled splits provide directional evidence,
not statistical generalization.

## Recommended next milestone

Evaluate relationship-evidence admission and diversity on a larger, independently reviewed context
corpus, with particular attention to tests/UI/feature-flow completeness and inverse/module-level
noise, before changing any ranking policy or adding broader graph semantics.
