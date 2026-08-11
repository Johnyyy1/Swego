# Git and source ingestion

## Command

A repository must first exist in SWEGA's `repositories` table. Synchronize it with:

```bash
swega ingest-git <repository-id> --limit 100 --since 2025-01-01
```

During development:

```bash
bun run swega ingest-git <repository-id> --limit 100 --since 2025-01-01
```

`DATABASE_URL` is required. Managed clones are stored under `SWEGA_REPOSITORY_DIR` or `.swega/repositories` by default. `--limit` bounds the commit history synchronized into PostgreSQL; it does not limit the current tracked-file tree. `--since` applies to commit history.

## Flow

```text
Look up normalized Repository
              ↓
Clone to a temporary managed path, then atomically rename
or validate the existing managed clone
              ↓
Fetch origin updates, tags, and pruned references
              ↓
Resolve the remote default-branch revision
              ↓
Read bounded Git commit history → upsert Commit by repository + SHA
              ↓
Read current Git tree → synchronize repository_files metadata
              ↓
Set repositories.gitIndexedAt
```

Git commits and GitHub commit metadata converge on the same `(repositoryId, sha)` constraint. Git values overwrite commit author, message, and timestamp fields when the same SHA already exists because the Git object is authoritative for those fields.

## Git abstraction

`GitRepositoryManager` currently exposes:

- `cloneRepository()`
- `updateRepository()`
- `checkoutRevision()`
- `resolveRevision()`
- `listFiles()`
- `readFile()`
- `getCommitHistory()`
- `getFileHistory()`

The concrete implementation uses the installed Git CLI behind typed methods. Consumers do not construct shell commands or depend on working-tree layout.

`listFiles()` reads Git tree metadata without checking out or reading every file. `readFile()` reads a blob at a requested revision and defaults to a 10 MiB safety limit. The database stores file path, extension, lightweight language detection, size, and the revision at which that path was observed. It never stores complete source blobs or every historical file version.

## Safety and interruption handling

- Git commands use subprocess argument arrays, never a shell.
- System and global Git configuration are disabled for managed operations.
- Git hooks, recursive submodules, local transports, and interactive credential prompts are disabled.
- Initial clones use `--no-checkout`, write to a temporary sibling directory, validate the result, and atomically rename it into place.
- A failed clone removes its temporary directory. A later run replaces debris left by an interrupted process and reuses a valid completed clone.
- Synchronization inspects repository data only. It never installs dependencies, runs tests, invokes repository binaries, or executes repository scripts.

## Current limitations

- Production cloning supports HTTPS remotes only. Authentication for private Git remotes is not yet configured separately from GitHub API authentication.
- Concurrent synchronization of the same repository is not locked yet.
- Lightweight language detection uses filenames and extensions rather than GitHub Linguist or a parser.
- Non-UTF-8 Git paths are decoded with replacement characters.
- Git LFS objects are not downloaded; an LFS-tracked file may be read as its pointer content.
- File metadata describes the remote default-branch snapshot only. Other branches remain accessible through the Git abstraction but are not persisted as separate file rows.
