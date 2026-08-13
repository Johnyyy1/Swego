# Repository memory

## Purpose

Repository memory is a provider-independent, rebuildable layer between normalized source data and future retrieval implementations. It represents issues, issue comments, pull requests, reviews, commits, and source code through one document/chunk contract without discarding their original identity.

Embeddings and retrieval ranking are downstream projections and are not part of this normalization layer.

Static source relationships are also downstream, rebuildable enrichment. The TypeScript-family adapter extracts relative and statically configured local imports/re-exports from the same admitted source/config text during a memory build, then verifies exact targets against existing structural chunks. Git ingestion does not depend on it. See [Structural relationship expansion](structural-relationships.md).

## Model

A `Document` identifies one searchable version of one source entity. It stores:

- `repositoryId`
- `sourceType`
- internal `sourceEntityId`
- optional parent source type and entity ID for comment/review relationships
- `sourceVersion`
- original `sourceReference`
- optional title, path, and commit SHA
- content hash and chunking strategy
- `occurredAt`, `availableAt`, and optional `supersededAt`

The full searchable text is stored in `DocumentChunk` rows rather than duplicated on the document. Every chunk directly carries repository, source, parent-source, reference, temporal, path, and commit provenance in addition to its document relationship. Issue comments point to their normalized issue, and reviews point to their normalized pull request. This permits repository and temporal filtering or relationship expansion before any result reaches a future agent.

Provider references currently use stable normalized references such as `provider:github:issue:<provider-id>`. Git sources use `git:<sha>` or `git:<sha>:<path>`. They complement, rather than replace, SWEGA's internal entity IDs.

## Temporal identity

`occurredAt` describes when the source event happened. `availableAt` describes when the exact indexed version is safe to expose. They intentionally differ:

- Issues, comments, pull requests, and reviews use their provider creation time for `occurredAt` and their latest known provider update time for `availableAt`.
- Commits use author time for `occurredAt` and committer time for `availableAt`.
- Source-code snapshots use the snapshot commit time for both values.

Using the latest provider update time for mutable content is conservative. If SWEGA does not possess an earlier edit version, it delays the current text rather than leaking edited text into an earlier benchmark.

When a newer source version is indexed, the preceding document and chunks receive `supersededAt`. A historical query at cutoff `T` must use:

```sql
repository_id = :repository_id
and available_at <= :before
and (superseded_at is null or superseded_at > :before)
```

Repository filtering is mandatory. `createdAt` alone is never a safe historical-content filter for mutable entities.

## Deterministic identity and re-indexing

Document IDs are SHA-256 hashes of a versioned namespace, repository ID, source type, internal source entity ID, and source version. Chunk IDs additionally include the chunking strategy, chunk index, and content hash.

Database uniqueness constraints enforce one document per repository/source/version and one chunk per document position. Re-indexing unchanged sources upserts the same IDs and removes only obsolete chunks belonging to that document. A changed source version creates a new document and closes the older validity interval, retaining historical provenance.

## Chunking

Natural-language provider content is normalized into small labeled sections and grouped at paragraph boundaries with a conservative character limit. Long paragraphs fall back to whitespace boundaries.

Source code first passes through the provider-neutral `SourceStructureParser` contract. The initial TypeScript compiler adapter recognizes TypeScript, TSX, JavaScript, and JSX and emits declarations for functions, methods, classes, interfaces, type aliases, enums, properties, and module-level variables. Those files use `source_code_structural_v1`; every chunk records language, symbol identity/kind, optional parent symbol, exact line range, and subdivision position.

Class chunks retain their declaration header while members receive separate chunks, avoiding a copy of the whole class for every method. Module gaps preserve imports and unrecognized top-level statements without repeating them in each symbol. Nested named function constructs are emitted with their nearest enclosing symbol. Structural units above 120 lines or 12,000 characters are divided into bounded pieces with a short signature context and a shared deterministic symbol ID.

Unsupported extensions, syntax errors, a parser that yields no structures, and unexpected parser-adapter failures all use the existing `source_code_v1` line strategy. The fallback preserves the former 120-line/12,000-character bounds and 20-line overlap. Parser enrichment can therefore never prevent repository memory from being built.

The source-code builder:

- reads blobs through the Git abstraction at the recorded revision
- never executes repository code
- skips empty, binary, non-UTF-8, and oversized files
- classifies low-value tracked files at the derived-memory boundary without deleting their `repository_files` rows
- records a stable reason for every excluded source file and summarizes reasons in build logs
- stores current indexed snapshot chunks as derived data while Git remains authoritative

It does not walk every historical file version.

## Source-file classification

The default policy excludes only strong, repository-independent signals:

- lock/cache metadata and conventional dependency or generated-output trees
- conventional snapshots and minified JavaScript/CSS assets
- SVG assets
- files with strong generated/do-not-edit markers in the first 2 KiB
- generated OpenAPI bundles only when a sibling modular `src` source of truth is tracked
- translated locale catalogs when exactly one `en-US` catalog is present in the same catalog group

Ambiguous files remain admitted. Package/workspace and deployment configuration, authored JSON/YAML and documentation, API specifications without source-of-truth evidence, tests, migrations, SQL, large authored source files, and repository instructions are kept by default. The classifier accepts a canonical-locale option so a future repository-level configuration can override `en-US` without changing Git ingestion or document normalization.

Rebuilding atomically reconciles the current source-code projection: obsolete chunks for an otherwise stable document are removed before new chunk positions are inserted, source documents no longer admitted by the classifier are deleted, and database cascades remove their embeddings. This handles the one-time transition from text to structural chunk IDs without a uniqueness collision or orphaned projection. Historical issue, pull-request, review, comment, and commit documents are not part of this reconciliation. Repeating an unchanged rebuild retains deterministic document, symbol, and chunk IDs and removes nothing.

## Build flow

After GitHub and Git synchronization, run:

```bash
swega build-memory <repository-id>
```

The indexer loads normalized repository-scoped entities, normalizes metadata documents, reads safe text blobs through `GitRepositoryManager`, creates deterministic chunks, and persists them transactionally. The worker API is also available directly as `buildRepositoryMemory()`.

Once built, the memory can be embedded and searched as described in [Repository Memory Retrieval](retrieval.md).

Embedding regeneration processes stale chunks in deterministic content-length order before stable ID order. This keeps similarly sized inputs together for better local-provider batching while leaving vector contents and retrieval scoring unchanged.

See [Structural source chunking](structural-chunking.md) for parser boundaries, metadata, and operational implications.
