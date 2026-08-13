# Alias and exact-symbol milestone baseline

Recorded before implementation on 2026-08-13 from the checked-in Evidence Pack result at commit
`59edc97e806559ede7ff432ddf8abd3350c93c2f`.

The live reproduction command was attempted once:

```bash
bun run swega context-benchmark benchmarks/formbricks-context-development.json
```

It could not produce a report because the configured Neon database rejected queries with
`Your project has exceeded the data transfer quota. Upgrade your plan to increase limits.` The
task-owned CLI process was stopped after confirming it was not performing database I/O or inference.
No memory rebuild or embedding regeneration was performed.

| Strategy      | Required | Supporting | Complete | Precision | Duplicate | Noise | Relevant files |  Chars | Budget |   Search | Expansion |    Total |
| ------------- | -------: | ---------: | -------: | --------: | --------: | ----: | -------------: | -----: | -----: | -------: | --------: | -------: |
| raw top-K     |    0.413 |      0.320 |    0.160 |     0.104 |     0.015 | 0.896 |           0.92 | 30,000 |  1.000 | 704.2 ms |    0.0 ms | 704.2 ms |
| Evidence Pack |    0.633 |      0.420 |    0.440 |     0.153 |     0.000 | 0.847 |           1.32 | 20,880 |  0.696 | 674.0 ms |  121.0 ms | 795.3 ms |

The baseline uses the existing 30,000-character context budget, five anchors, bounded depth-one
relationship expansion, and the non-reranked production context configuration. These values are a
recorded pre-change reference, not a fresh 2026-08-13 timing sample.

## Pre-change relationship projection

A source-only dry extraction over the pinned Git tree used the production path/header admission
rules and the existing extractor without persistence or SWEGA rankings:

| Measure                                |    Value |
| -------------------------------------- | -------: |
| Admitted TypeScript-family files       |    3,163 |
| Parsed relative/local bindings         |    4,857 |
| Resolved relationships                 |    4,678 |
| Unresolved relative/local bindings     |      179 |
| Ambiguous relative/local bindings      |        0 |
| Configured-looking `@/` alias bindings |   10,161 |
| Resolved `@/` alias bindings           |        0 |
| `IMPORTS` relationships                |    4,487 |
| `REEXPORTS` relationships              |      191 |
| Extraction duration                    | 579.4 ms |

Counts are binding-level because one import declaration can statically name several independently
targetable symbols. The dry-run denominator includes admitted TypeScript-family source at the pinned
revision and excludes external/package bindings from the local-resolution rate.
