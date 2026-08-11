# Normalized repository data model

SWEGA stores provider data in a normalized, repository-scoped model. UUID primary keys are owned by SWEGA; provider identifiers are retained separately for synchronization and provenance.

## Entities

- `repositories` identifies a source repository by provider, optional stable provider ID, owner, name, and canonical URL. `indexedAt` records the most recent successful repository indexing boundary.
- `commits` stores immutable Git commit identity, message, author information, and both author and committer timestamps. A SHA is unique within a repository.
- `repository_files` stores current tracked-file metadata: path, optional detected language and extension, byte size, and the Git revision at which the path was observed. It does not store file contents.
- `issues` and `pull_requests` store provider IDs, optional human-facing numbers, normalized state, content, authors, lifecycle timestamps, and synchronization metadata.
- `issue_comments` belong to issues. Bodies and authors are nullable because content can be empty, removed, or authored by a deleted account.
- `pull_request_files` record the paths and change counts associated with a pull request. Their repository ID is intentionally duplicated to enforce isolation.
- `reviews` belong to pull requests and preserve normalized state and creation time. Review bodies and authors may be absent.
- `documents` identify versioned, searchable representations of normalized source entities. Optional parent-source fields preserve issue-comment and review relationships. `document_chunks` contain the searchable text and repeat repository, relationship, provenance, and temporal metadata for safe filtering.
- `chunk_embeddings` is a rebuildable pgvector projection of the current embedding for each chunk. It records repository, provider, model, dimensions, content hash, and embedding time so stale vectors can be replaced safely.

Mutable provider entities include `sourceUpdatedAt`, `lastSyncedAt`, and `deletedAt` where applicable. `sourceUpdatedAt` is the provider's last known modification time, `lastSyncedAt` is SWEGA's latest observation time, and `deletedAt` represents a retained tombstone instead of silently losing provenance.

## Relationships

```text
Repository
├── Commit
├── RepositoryFile
├── Issue
│   └── IssueComment
├── PullRequest
    ├── PullRequestFile
    └── Review
└── Document
    └── DocumentChunk
        └── ChunkEmbedding
```

All source tables include `repositoryId`. Direct children reference `repositories.id`. Nested children use composite foreign keys such as `(repositoryId, issueId) -> issues(repositoryId, id)`, preventing a record scoped to one repository from referencing a parent in another repository. Cascading deletes keep the graph internally consistent if a repository or parent record is removed.

## Important constraints and indexes

- Internal UUIDs are primary keys; GitHub or other provider IDs never become SWEGA primary keys.
- Provider IDs and commit SHAs are unique only within a repository, supporting idempotent upserts without assuming globally unique provider values.
- File paths are unique within a repository. Synchronization updates current paths and removes metadata for paths no longer tracked at the synchronized revision.
- Repository provider IDs are optional for generic Git remotes, but unique within a provider when present.
- Issue and pull-request numbers are optional because not every provider requires numeric identifiers. When present, they are unique within their repository and entity type.
- State and pull-request file status checks enforce the current normalized vocabulary.
- Addition and deletion counts cannot be negative.
- Repository-plus-timestamp indexes support repository-isolated chronological queries. Source-update indexes support incremental reconciliation.
- `(repositoryId, sourceType, sourceEntityId, sourceVersion)` uniquely identifies a document version. `(repositoryId, documentId, chunkIndex)` uniquely identifies a chunk position, and deterministic primary IDs make unchanged re-indexing idempotent.
- `(repositoryId, chunkId)` is a composite foreign key from embeddings to chunks. This makes cross-repository vector associations invalid even though deterministic chunk IDs are globally unique primary keys.
- The HNSW index uses cosine distance. Stored rows identify their embedding provider, model, fixed dimensions, and source content hash; retrieval only compares compatible query and chunk vectors.
- Repository creation times, default branches, bodies, provider update times, deletion times, and hosted-service authors are nullable when the source can legitimately omit them. An unknown repository creation time stays unknown rather than being replaced with an ingestion timestamp. Commit authors remain required because they are intrinsic to a Git commit.

## Temporal retrieval

Historical retrieval must filter source information before it reaches an agent. Event timestamps such as `createdAt`, `authoredAt`, `committedAt`, `closedAt`, and `mergedAt` establish when events occurred. `committedAt` is stored separately because an author timestamp can be backdated and is not a safe proxy for when a commit entered history.

Mutable rows also preserve `sourceUpdatedAt`. A future retrieval layer can exclude a current row whose known version was updated after a cutoff, avoiding future-information leakage. This first model does not retain every historical edit, so it cannot yet reconstruct the pre-edit body of an issue, comment, pull request, or review. Version/event tables may be required when exact historical reconstruction is implemented.

`repository_files.lastKnownCommitSha` is snapshot provenance: it identifies the exact revision whose tree supplied the metadata and content address, rather than duplicating each file's modification history in PostgreSQL. `getFileHistory()` queries Git when modification history is needed. `repositories.gitIndexedAt` records the last fully successful Git/file synchronization independently from provider metadata indexing.

Repository-memory rows distinguish `occurredAt`, the source event time, from `availableAt`, the earliest safe time at which that exact searchable version may be returned. `supersededAt` closes the version's validity interval. Historical retrieval must filter by repository and by this interval; creation timestamps alone are not safe for mutable content.

Repository Memory Retrieval v1 applies that interval predicate in the same SQL query that orders vectors. A caller-supplied cutoff therefore constrains the candidate set before results leave PostgreSQL.
