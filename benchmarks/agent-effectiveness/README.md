# P17 agent-effectiveness benchmark

Benchmark version: `swega-agent-effectiveness-v1`

## Research question

Does giving the same Codex coding agent access to SWEGA MCP improve performance on realistic software-engineering tasks?

The primary outcome is task success according to a task-specific hidden behavioral verifier. The design is paired: each of 12 final tasks is run once as baseline A and once as treatment B. Pilot tasks validate infrastructure only and are excluded from final analysis.

P17A authors, validates, pilots, and freezes this benchmark. It must not execute the 24 final runs. P17B executes the frozen order and analyzes the results.

## Layout

```text
benchmarks/agent-effectiveness/
  README.md                       methodology and operating procedure
  manifest.freeze.json            complete machine-readable freeze
  manifest.freeze.sha256          accidental-drift checksum
  private.bundle.enc.json         encrypted graders and reference patches
  run-result.schema.json          stable result artifact schema
  conditions/{A,B}.json           exact condition configurations
  tasks/
    tasks.json                    public metadata and prompt digests
    final/FB-F*/prompt.txt        12 solver prompts
    pilot/FB-P*/prompt.txt        infrastructure-only prompts
  src/                            runner, parsers, grader, freeze, analysis
  tests/                          tooling and isolation tests
```

Runtime state is ignored under `.swega/p17-agent-benchmark/`: the clean base snapshot, independent run workspaces, structured transcripts, patches, grader output, and result JSON. Plaintext hidden graders and reference patches are never copied into a solver workspace.

## Frozen environment

The source repository is `formbricks/formbricks` at `88a38c081fc7536a4edf74f8b03f9cf9ce4ee2d5`, repository ID `a61b0198-8307-41b0-9b51-9c510793cefa`. SWEGA runtime behavior is commit `8814209`; environment documentation is commit `8501f34`.

The verified memory is 23,430 chunks, 23,430 compatible Ollama `qwen3-embedding:0.6b` embeddings at 512 dimensions, and 14,815 relationships. PostgreSQL is 17.10, pgvector is 0.8.6, Evidence Pack budget is 30,000 characters, reranking is disabled, and MCP uses local stdio. No retrieval, context, tool-description, or production SWEGA code is modified by this benchmark.

The source declares pnpm 11.7.0. The installed runtime actually resolved pnpm 11.19.0; dependencies were installed once with `pnpm install --frozen-lockfile --ignore-scripts`, and that state is copied identically to both conditions. Graders call the installed local binaries directly and cannot reinstall dependencies.

## Task authoring and contamination controls

All task candidates and ground truth were created by manually reading an exported pinned Formbricks snapshot. SWEGA was not queried for candidates, relevant-file labels, expected implementations, or scoring. Existing SWEGA held-out/evaluation queries and sealed context corpora were not opened. Future Formbricks commits, branches, issues, PRs, and Evidence Packs were not used.

Prompts describe behavior and omit paths, symbols, hidden cases, expected patch shapes, and SWEGA queries. `tasks/tasks.json` records SHA-256 for the byte-identical prompt supplied to A and B. Categories and difficulties were fixed before measured execution.

Private metadata contains rationale, required outcomes, relevant and supporting files, verifier destinations, reference patches, and commands. It is encrypted with AES-256-GCM in `private.bundle.enc.json`; the key is not committed, not in the source workspace, and is stripped from the Codex child environment. On this P17A host it is stored in the current user's macOS Keychain. This prevents accidental disclosure to ordinary solver behavior; it is not hostile same-user containment.

Every reference patch is applied to a new clean base. Validation requires the task-specific hidden verifier to reject untouched source and accept the reference patch. It then records a frozen scoped regression, type, or schema check; those supplemental checks are not part of task success because several packages depend on build artifacts intentionally absent after the no-scripts install. Reference patches and relevant-file labels are analysis/grading data only.

## Source and workspace isolation

The runner exports the exact revision with `git archive`, extracts it, installs frozen dependencies without lifecycle scripts, initializes a new Git repository, and creates one deterministic baseline commit. The base has exactly one commit, no remotes, no alternate object store, and no later refs. Agents retain `git status`, `git diff`, and ordinary source workflows but cannot use local Git history to find future solutions.

Each attempt is a copy-on-write copy of that base:

```text
.swega/p17-agent-benchmark/workspaces/<task>/<condition>/attempt-<retry>/
```

An existing attempt path is a hard error. A and B begin at the same commit/tree and never share modifications, transcripts, patches, or grader output. The hidden verifier is decrypted into a grader-only runtime directory and injected only after Codex exits; it is removed after grading.

## Conditions

Both conditions run `/Applications/ChatGPT.app/Contents/Resources/codex` version `codex-cli 0.147.0-alpha.6.6` with:

- model `gpt-5.6-sol`;
- reasoning effort `xhigh`;
- `workspace-write` sandbox and approval policy `never`;
- ephemeral session, ignored user config, strict explicit config;
- the same shell, repository reads/search, editing, tests, and Git tools;
- apps, plugins, browser tools, computer use, multi-agent, skill search, and image generation disabled;
- no extra environment-level instruction.

The solver subprocess receives a fixed operational allowlist (path, locale, shell, temporary/home, and Codex runtime variables) plus non-interactive Git flags. Database URLs, provider/API tokens, grader keys, and all other ambient variables are omitted.

Condition A registers no MCP server. Preflight uses an empty temporary `CODEX_HOME` and rejects any baseline SWEGA registration.

Condition B adds only the frozen local stdio `swega` MCP registration with `swega_list_repositories`, `swega_get_repository`, and `swega_get_context`. It uses the frozen local database/Ollama configuration and leaves reranking disabled. No instruction requires or encourages SWEGA use; available-but-unused is valid.

The child has no browser or web-search capability. A P17A probe from the installed `workspace-write` shell could not resolve external DNS, but this is not an independently enforced OS-level egress firewall, so the benchmark claims only disabled browser/search tools plus the observed shell restriction. Local stdio MCP remains available to B.

## Limits and retry policy

The frozen wall/session limit is 1,800,000 ms (30 minutes), followed by SIGTERM and a 10,000 ms SIGKILL grace. No reliable token ceiling is exposed by this Codex runtime, so no estimated ceiling is invented; authoritative usage is recorded from `turn.completed` when available.

At most one retry is allowed, and only when the harness records a verified infrastructure failure such as Codex service/authentication failure, MCP startup/database failure, or harness infrastructure failure. A normal timeout, bad edit, failed test, poor context, or ordinary Codex error is not retried. Every attempt gets an immutable artifact directory and retry number. Analysis selects the highest valid retry for each pair.

P17B must start with enough Codex account capacity for 24 `gpt-5.6-sol` xhigh sessions plus the single allowed infrastructure retry. P17A pilot execution encountered the service's structured usage-limit response after one complete solver run; the classifier and unit tests therefore consume structured `error`/`turn.failed` events rather than relying on stderr.

## Randomization

Seed `swega-p17a-20260813` is passed to `sha256-sort-and-pair-parity-v1`: tasks are deterministically SHA-256 sorted, and hash parity selects A-first or B-first within each pair. The complete final and pilot order is persisted in the freeze manifest. P17B consumes it without regeneration or reordering.

## Metrics and counting semantics

Primary metric: hidden-verifier task success. Paired outcomes are A pass/B pass, A pass/B fail, A fail/B pass, and A fail/B fail.

Correctness artifacts include every hidden/scoped test result, verifier pass, modified-file list, and `git diff --numstat` patch size. Task success requires the hidden behavioral verifier; the frozen task-specific regression/type/schema command is supplemental and records unrelated regressions where the isolated dependency state can execute it. The full Formbricks test suite is not run per solver attempt.

Time is Codex wall time, excluding post-session grading. Structured event receipt time gives time to first direct file read, first relevant-file read, and first structured file-change event. Time to passing hidden verifier is explicitly unavailable because hidden grading occurs only after the solver exits.

Exploration is parsed from structured `command_execution` events, not pretty terminal text:

- each `cat`, `head`, `tail`, `less`, `sed`, `awk`, or `nl` pipeline component with a repository file path in its command is one direct file-read operation; a downstream pager such as `rg … | head` is not a file read;
- repeated reads count repeatedly; normalized paths form the distinct-file set;
- each `rg` or `grep` command is one search operation, even if repository-wide;
- each `find`, `ls`, `tree`, `fd`, or Git status/diff/log/show/ls-files command is one shell discovery operation;
- relevant/irrelevant visits are intersections/differences against frozen relevant-file labels;
- grader and harness file access never enters the Codex transcript and is not counted.

These definitions are conservative and can undercount reads performed through an unrecognized compound shell expression. They are frozen rather than adjusted after results.

Usage comes only from authoritative structured `turn.completed` fields: input, output, cached input, cache-write input, and reasoning output. Missing fields are `null`; total is computed only when input and output both exist.

For B, structured `mcp_tool_call` events record call count, tools, `swega_get_context` count/query, elapsed receipt-time latency, structured evidence count, budget used characters, surfaced paths, and intersection with later opened/edited files. No regex extraction from prose is used.

## Runner and artifacts

`src/cli.ts` selects the frozen task/order, creates a workspace, launches a fresh Codex session, timestamps JSONL events, enforces timeout, captures stderr/final text, preserves a binary-safe patch, injects and runs the hidden verifier, collects metrics, and writes an immutable `result.json` matching `run-result.schema.json`. Runtime state is retained for audit; “cleanup” means terminating processes and removing decrypted grader files, not deleting result evidence.

Useful P17A validation commands:

```bash
bun run benchmark:p17:test
bun run benchmark:p17:typecheck
bun run benchmark:p17 validate
bun run benchmark:p17 dry-run
bun run benchmark:p17 validate-references
bun run benchmark:p17 run-pilots
```

Dry-run verifies artifact hashes/order, task definitions, source isolation, exact Codex version/model/effort, A's absent MCP, B's exact MCP, database counts/revision, Ollama model, live SWEGA connectivity, and grader reachability/isolation. It does not launch a final solver run.

## P17B execution and analysis

Run preflight immediately before execution:

```bash
bun run benchmark:p17 dry-run
```

Then the exact final command is:

```bash
bun run benchmark:p17 run-final --confirm-final
```

The explicit confirmation makes accidental P17A execution fail closed. After all 24 results exist:

```bash
bun run benchmark:p17 analyze
```

Analysis reports A/B successes, four paired outcome cells, absolute B-minus-A success difference, per-task results, median paired B-minus-A wall time/exploration/token differences, SWEGA availability/use, and directional category counts. Exact two-sided McNemar uses only discordant pairs. Twelve tasks provide low statistical power; no causal or category-level overclaim is warranted.

## Threats to validity fixed before execution

- Twelve tasks, one repository, one snapshot, one model, and one stochastic run per cell limit generalization and power.
- Tasks are manually authored from source rather than sampled historical tickets; author judgment may affect realism and difficulty.
- Relevant-file labels and category/difficulty assignments are manual and imperfect.
- Treatment exposes repository memory unavailable in the one-commit baseline; this is the intended SWEGA intervention, but results do not isolate individual retrieval mechanisms.
- Conservative structured-event semantics undercount some compound-shell exploration and cannot observe cognitive use of context.
- Shell network blocking was observed, not enforced by a separately audited OS firewall.
- Encrypted graders prevent accidental solver access, not a malicious same-user process deliberately attacking the host Keychain.
- The installed pnpm version differs from the repository declaration, though dependency state is identical for A and B.
- SWEGA may be available but unused; treatment assignment measures availability, not forced compliance.
- Exact McNemar is valid for paired binary outcomes, but with 12 pairs its resolution is coarse.

Pilot outcomes are reported only as harness evidence and must never be merged into final result paths or metrics.
