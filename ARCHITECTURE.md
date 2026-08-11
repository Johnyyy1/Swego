# SWEGA Architecture

## 1. Purpose

SWEGA is a repository-agnostic intelligence and memory layer for AI software engineering agents.

Its core responsibility is to ingest a software repository and its development history, transform that information into structured and searchable repository intelligence, and expose relevant context to coding agents.

SWEGA is not primarily a coding agent.

The core system must remain usable independently from:

- any specific LLM provider
- any specific coding agent
- GitHub as the only repository provider
- any programming language
- any frontend framework
- MCP
- the web application

The architecture must preserve these properties throughout development.

---

# 2. Core Architecture Principles

## 2.1 Repository Agnostic

SWEGA must never contain core logic designed around one specific repository.

Formbricks or any other repository may be used for development and evaluation, but production code must not contain repository-specific assumptions.

Forbidden examples:

```ts
if (repo.name === "formbricks") {
  ...
}
```

```ts
const sourceRoot = "apps/web";
```

```ts
if (repoUsesNextJs) {
  // core retrieval logic
}
```

Repository-specific behavior may only exist inside explicitly isolated adapters when unavoidable.

---

## 2.2 Language Agnostic

The core repository model must not depend on TypeScript, JavaScript, Python, Go, Java, Rust, or any other language.

Language-specific parsing belongs in:

```text
packages/code-analysis
```

or equivalent language adapters.

Core modules operate on normalized structures such as:

```text
Repository
File
Symbol
Commit
Issue
PullRequest
Review
Document
DocumentChunk
```

---

## 2.3 Provider Agnostic

GitHub is the first supported development platform.

However, GitHub-specific behavior must remain isolated from SWEGA's normalized internal model.

The architecture must make future adapters for providers such as GitLab possible without redesigning the core system.

Example:

```text
GitHub API
    ↓
GitHub Adapter
    ↓
Normalized SWEGA Entities
```

Never expose raw GitHub API structures throughout the application.

---

## 2.4 Agent Agnostic

SWEGA must not depend on one specific coding agent.

SWEGA exposes repository intelligence through stable internal APIs and, eventually, external protocols such as MCP.

Possible consumers include:

```text
SWEGA benchmark agent
Codex
Claude Code
other MCP-compatible agents
future APIs
```

Retrieval code must never depend directly on a particular agent implementation.

---

# 3. System Model

SWEGA consists conceptually of six major subsystems.

```text
                    ┌─────────────────────────┐
                    │        Repository       │
                    │ Git + development data  │
                    └────────────┬────────────┘
                                 │
                                 ▼
                        1. INGESTION
                                 │
                                 ▼
                     Normalized Repository
                                 │
                                 ▼
                     2. CODE UNDERSTANDING
                                 │
                                 ▼
                    Repository Intelligence
                                 │
                                 ▼
                          3. INDEXING
                                 │
                                 ▼
                       Repository Memory
                                 │
                                 ▼
                         4. RETRIEVAL
                                 │
                                 ▼
                           Context API
                                 │
                   ┌─────────────┴─────────────┐
                   ▼                           ▼
              5. SERVING                  6. EVALUATION
             MCP / API                     Benchmarks
                   │                           │
                   ▼                           ▼
            Coding Agents               Sandbox Runner
```

---

# 4. Monorepo Structure

Target architecture:

```text
swega/
├── apps/
│   ├── web/
│   ├── cli/
│   └── mcp-server/
│
├── packages/
│   ├── core/
│   ├── db/
│   ├── github/
│   ├── git/
│   ├── code-analysis/
│   ├── documents/
│   ├── embeddings/
│   ├── retrieval/
│   ├── agent-tools/
│   └── shared/
│
├── workers/
│   ├── indexer/
│   └── benchmark-runner/
│
├── docs/
│   ├── architecture.md
│   ├── data-model.md
│   ├── ingestion.md
│   ├── retrieval.md
│   ├── benchmark.md
│   └── decisions.md
│
└── tests/
```

Not every package must exist immediately.

Create packages only when their responsibility actually exists.

Do not create speculative abstractions merely to match this target structure.

---

# 5. Dependency Rules

Dependency direction is one of the most important architectural constraints.

Higher-level interfaces depend on lower-level functionality.

Core logic must never depend on presentation or transport layers.

Valid direction:

```text
web ───────────────┐
cli ───────────────┤
mcp-server ────────┤
                   ▼
             application/core
                   │
       ┌───────────┼───────────┐
       ▼           ▼           ▼
   retrieval    documents     repository
       │           │             │
       ▼           ▼             ▼
 embeddings       db          git/provider
```

Forbidden dependency examples:

```text
core → Next.js
retrieval → MCP server
db → web
documents → React
github → UI
git → agent
```

Packages must not import from `apps/*`.

Workers may consume packages.

Apps may consume packages.

Packages must not depend on apps.

---

# 6. Source Data vs Derived Data

SWEGA strictly distinguishes between source data and derived data.

## Source Data

Examples:

```text
Repository
Issue
IssueComment
PullRequest
Review
Commit
File metadata
```

Source data represents information obtained from Git or repository providers.

Source data should be preserved whenever reasonably possible.

---

## Derived Data

Examples:

```text
Document
DocumentChunk
Embedding
Symbol
Code relationship
AI-generated summary
Retrieval score
Repository insight
```

Derived data must be rebuildable from source data.

A migration or indexing change must not require re-downloading the entire repository history unless necessary.

This means:

```text
SOURCE DATA
     ↓
DERIVED DATA
```

Never make source entities depend on embeddings, chunks, or AI-generated output.

---

# 7. Normalized Repository Model

Provider-specific IDs must never be used as SWEGA's internal primary keys.

Every entity receives an internal SWEGA identifier.

Provider identifiers are stored separately.

Example conceptual model:

```ts
Repository {
  id
  provider
  providerId
  owner
  name
  url
  defaultBranch
}
```

```ts
PullRequest {
  id
  repositoryId
  providerId
  number
  title
  body
  createdAt
  mergedAt
}
```

Every repository-scoped entity must include or derive a repository identity.

Cross-repository leakage is considered a critical bug.

---

# 8. Temporal Correctness

Time is a first-class concept in SWEGA.

Repository intelligence will be evaluated historically.

If SWEGA evaluates a task at time:

```text
2025-03-15T10:00:00Z
```

it must not retrieve information that became available after that timestamp.

Correct:

```sql
WHERE available_at <= :cutoff
```

Incorrect:

```text
retrieve everything
→ ask LLM to ignore future information
```

Temporal filtering must occur at the data/retrieval layer.

Every searchable historical entity must preserve timestamps sufficient to determine when the information became available.

Data leakage is considered a critical evaluation failure.

---

# 9. Git and Provider Separation

Git and GitHub are different concerns.

## Git Provider Layer

Responsible for:

```text
clone
fetch
checkout
commit history
file history
diffs
reading files
listing files
```

Git repository contents remain the source of truth for actual source code and historical revisions.

---

## GitHub Adapter

Responsible for:

```text
repository metadata
issues
issue comments
pull requests
PR files
reviews
GitHub-specific relationships
rate limits
pagination
provider authentication
```

Do not use GitHub API as the source of truth for repository file contents if Git can provide the information directly.

---

# 10. Ingestion Architecture

Repository ingestion is performed by background/worker logic, not by long-running web requests.

Conceptual pipeline:

```text
Repository URL
     ↓
Register repository
     ↓
Sync provider metadata
     ↓
Clone / update Git repository
     ↓
Normalize entities
     ↓
Build searchable documents
     ↓
Chunk
     ↓
Generate embeddings
     ↓
Index
```

Each stage should be independently rerunnable whenever practical.

Examples:

```text
syncRepository()
syncIssues()
syncPullRequests()
syncCommits()
syncFiles()
buildDocuments()
buildChunks()
buildEmbeddings()
```

Ingestion must be idempotent.

Re-running ingestion must not create duplicate entities.

Partial failure should not require restarting the entire pipeline from zero.

---

# 11. Document Layer

Raw entities are not the retrieval interface.

Searchable information is represented through a normalized document abstraction.

Conceptually:

```text
Issue ───────────┐
Pull Request ────┤
Review ──────────┤
Commit ──────────┼──► Document ─► DocumentChunk
Source Code ─────┤
Discussion ──────┘
```

Every document/chunk must retain sufficient provenance.

At minimum:

```text
repositoryId
sourceType
sourceId
availableAt
path when relevant
commit SHA when relevant
source metadata
```

Retrieval results must always be traceable back to their source.

---

# 12. Retrieval Architecture

Repository retrieval must have one stable core interface.

Conceptual API:

```ts
searchMemory({
  repositoryId,
  query,
  before,
  sourceTypes,
  paths,
  limit,
});
```

Retrieval may internally combine:

```text
vector search
full-text search
symbol search
file/path relevance
metadata filtering
temporal filtering
reranking
```

Consumers must not need to know which retrieval technologies are used internally.

Retrieval strategies should therefore be replaceable without changing agent APIs.

---

# 13. Code Intelligence

Code intelligence belongs in an isolated subsystem.

Initial versions may use conservative text-based source chunking.

Later versions may use Tree-sitter to extract:

```text
functions
classes
methods
interfaces
imports
symbols
relationships
```

Tree-sitter-specific representations must not escape into the rest of the system.

Convert language-specific AST output into normalized SWEGA entities.

---

# 14. Embeddings

Embedding generation must be provider-independent.

Define an internal abstraction such as:

```ts
interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}
```

One provider may be implemented initially.

Do not spread provider SDK calls across retrieval or application code.

Switching an embedding model should not require rewriting the retrieval architecture.

---

# 15. Agent Tools

Agents consume SWEGA through stable tools.

Potential capabilities:

```text
search_history
search_code
find_similar_pull_requests
find_related_issues
get_file_history
find_symbol
get_architectural_context
```

Agent-facing APIs must return structured data with provenance.

Do not expose raw database rows directly to agents.

---

# 16. MCP

MCP is a transport/integration layer.

MCP must not become the core architecture.

Correct:

```text
Agent
  ↓
MCP server
  ↓
SWEGA agent-tools
  ↓
retrieval/core
```

Incorrect:

```text
retrieval logic implemented directly in MCP handlers
```

The same tools should theoretically be callable from:

```text
MCP
CLI
internal benchmark agent
HTTP API
tests
```

---

# 17. Benchmark Architecture

Evaluation must remain independent from normal ingestion and retrieval.

Conceptual workflow:

```text
Historical Task
      ↓
Create isolated workspace
      ↓
Checkout historical revision
      ↓
Configure retrieval cutoff
      ↓
Run agent
      ↓
Apply changes
      ↓
Run tests
      ↓
Collect metrics
      ↓
Destroy environment
```

Benchmark runs must store sufficient metadata for reproduction.

Examples:

```text
repository
base commit
task
model
configuration
retrieval strategy
retrieved context
generated patch
test result
token usage
latency
cost
timestamp
```

---

# 18. Execution Security

SWEGA ingests untrusted repositories.

Ingestion and indexing must NEVER execute repository code.

During normal indexing, never:

```text
npm install
pnpm install
pip install
cargo build
go test
execute repository scripts
execute binaries
```

Execution belongs exclusively inside the isolated benchmark/execution subsystem.

Eventually this should use Docker or equivalent isolation.

Repository contents must be treated as untrusted input.

---

# 19. Observability

Important operations should produce structured logs.

Especially:

```text
repository ingestion
GitHub synchronization
Git operations
document generation
embedding generation
retrieval
benchmark runs
agent tool calls
```

Logs should contain IDs and useful context, not enormous raw payloads.

Never log credentials, access tokens, or secrets.

---

# 20. Error Handling

Errors should preserve subsystem boundaries.

Examples:

```text
GitHubRateLimitError
RepositoryCloneError
RepositoryNotFoundError
IndexingError
EmbeddingProviderError
RetrievalError
TemporalConstraintError
```

Do not swallow errors silently.

Avoid generic:

```ts
catch {
  return null;
}
```

unless null explicitly represents a valid state.

---

# 21. Testing Strategy

Critical invariants require tests.

Highest priority:

```text
repository isolation
idempotent ingestion
provider normalization
temporal filtering
duplicate prevention
document provenance
retrieval cutoff correctness
Git URL parsing
historical checkout correctness
```

AI output itself should not be tested through exact string equality.

Test structured properties and behavior.

---

# 22. Architectural Decision Records

Meaningful architectural decisions belong in:

```text
docs/decisions.md
```

or individual ADR files.

Document decisions when they affect:

```text
data model
public interfaces
package boundaries
retrieval architecture
provider architecture
benchmark methodology
security model
```

Do not document trivial implementation details as architecture decisions.

---

# 23. Non-Goals

Unless explicitly added later, SWEGA is not:

```text
a GitHub replacement
a Git hosting platform
an IDE
a general vector database
a generic chatbot
a Claude Code clone
a CI/CD platform
a full source-code security scanner
```

Avoid feature creep into these areas.

---

# 24. Architectural Invariants

The following rules are mandatory.

1. Core modules remain independent from Next.js.
2. Core modules remain independent from MCP.
3. Core modules remain independent from a specific LLM.
4. Provider-specific models do not leak into the normalized domain model.
5. Repository-specific hacks are forbidden.
6. Repository-scoped data must never leak across repositories.
7. Temporal filtering must happen before context reaches an agent.
8. Derived data must remain rebuildable.
9. Ingestion must not execute untrusted repository code.
10. Retrieval results must preserve provenance.
11. Long-running work must not execute inside normal web requests.
12. Every major subsystem must be testable independently.
13. New abstractions must solve an existing problem, not a hypothetical future problem.
14. Existing working architecture must not be redesigned without concrete justification.

Any implementation conflicting with these invariants requires an explicit architectural decision and human review.
