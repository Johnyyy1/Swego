# Structural source chunking

## Scope

SWEGA turns supported source files into bounded chunks that correspond to useful program structures. This is syntax-aware indexing, not compilation or a universal semantic analyzer: it does not load a project configuration, resolve imports, infer types, or execute repository content.

## Parser architecture

`packages/documents` defines a provider-neutral `SourceStructureParser`:

```ts
interface SourceStructureParser {
  readonly id: string;
  parse(input: { path: string; content: string }): SourceStructureParseResult;
}
```

The result explicitly distinguishes unsupported input, parse failure, and successful structure discovery. Repository-memory normalization receives the parser as an optional dependency, making failure and rebuild behavior testable without coupling the indexer or retrieval packages to TypeScript.

The default adapter uses the TypeScript compiler parser (`createSourceFile` plus syntax-tree traversal). It parses text only. This is a practical fit for SWEGA because the current repository set is dominated by TypeScript-family code, the same parser covers all four target dialects, and the TypeScript runtime is pure JavaScript. A future Tree-sitter adapter can add other languages behind the same contract when the value justifies native/WASM runtime and grammar packaging.

## Supported files and structures

| Extension             | Language   | Structural units                                                                                                                                       |
| --------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.ts`, `.mts`, `.cts` | TypeScript | functions, arrow/function variables, classes, methods/accessors/constructors, interfaces, types, enums, properties, namespaces, module-level variables |
| `.tsx`                | TSX        | TypeScript structures plus JSX function/arrow components                                                                                               |
| `.js`, `.mjs`, `.cjs` | JavaScript | functions, arrow/function variables, classes, methods, properties, and module-level variables                                                          |
| `.jsx`                | JSX        | JavaScript structures plus JSX function/arrow components                                                                                               |

Named nested functions and arrow-function variables keep the nearest enclosing function or class member as `parentSymbol`. Class chunks contain the class signature/header; each class member is a separate chunk. Imports, directives, and otherwise unrecognized top-level text are retained in module chunks rather than copied into every declaration.

## Bounds and context

A structural unit is emitted directly when it is no larger than 120 lines and 12,000 characters. Larger symbols are divided deterministically on line boundaries. Every part keeps the same symbol ID and records `symbolPart` and `symbolPartCount`; parts receive one short generated context line containing the symbol kind, name, parent, and truncated signature. The entire file or import list is never duplicated into every part.

## Chunk metadata

In addition to existing repository, source, time, path, commit, and line provenance, source chunks expose:

- `language`
- `symbolId`
- `symbolName`
- `symbolKind`
- `parentSymbol`
- `symbolPart`
- `symbolPartCount`

`symbolKind` is one of `class`, `enum`, `function`, `interface`, `method`, `module`, `property`, `type`, or `variable`. Module gaps have a null symbol name but a stable symbol ID. Text-fallback chunks keep `language` when it is known and set all symbol fields to null.

Document IDs remain based on stable source identity/version. Symbol IDs include the document, language, kind, name, parent, and complete symbol line range. Chunk IDs include the versioned chunk strategy, deterministic position, and content hash. Repeating a rebuild over the same snapshot therefore produces the same identities.

## Fallback and rebuild behavior

Unsupported extensions, syntax errors, empty structural results, and thrown adapter failures select `source_code_v1`, the existing bounded textual strategy. A parser problem cannot stop memory construction.

Moving a supported document from `source_code_v1` to `source_code_structural_v1` changes its derived chunk IDs while preserving its document ID. Persistence deletes obsolete chunks for that document before inserting the new positions; foreign-key cascades remove the corresponding old embeddings. Repository-level reconciliation then removes obsolete source documents. Run `embed-memory` after the first structural rebuild to project all new chunks. Subsequent unchanged builds are deterministic and do not invalidate embeddings.

Embedding projection orders stale chunks by content length and then stable chunk ID before batching. Grouping similar lengths avoids making every input in a batch pay the padding/context cost of an arbitrarily longer neighbor; it does not alter embeddings, ranking, or restart behavior.

## Retrieval behavior

Dense scoring, lexical scoring, structured scoring, RRF, and optional reranking remain separate production stages. The lexical projection places path and symbol name at weight A, content at B, parent symbol at C, and secondary provenance/structural fields at D. Candidate Generation v2 additionally maintains a structural-only projection: symbol and normalized path/filename terms use weight A, parent symbols use B, and symbol kind uses D. CamelCase/PascalCase queries are split at the query boundary; kebab/snake/path separators are normalized in PostgreSQL. Exact raw symbol equality is ranked first and protected during path diversification.

## Operational limits

- Structural chunking itself does not resolve project aliases, overload implementation relationships, inherited members, or cross-file references.
- A separate index-time syntax/config adapter extracts high-confidence relative and configured local imports/re-exports for bounded expansion, then verifies exact targets against these structural chunks. It does not change chunk boundaries or pretend package-manager aliases and semantic references are resolved.
- Anonymous callbacks are not assigned fabricated names.
- Outer functions may overlap a separately indexed named nested function because both are useful retrieval units.
- Unsupported languages retain textual chunking until another parser adapter is added.
- The TypeScript package adds roughly 25 MB to the installed runtime footprint; no models, native bindings, or grammars are downloaded.
- A structural migration may create more chunks and invalidate embeddings. Its one-time persistence and embedding costs depend on repository structure and local hardware.

On the pinned Formbricks smoke snapshot, source chunks grew from 7,582 to 23,430 (3.09×). A complete atomic rebuild on the local macOS arm64 development machine took 1,012 seconds; source read/parse took 136 seconds and existing per-document persistence bookkeeping dominated the remainder. The default Qwen3 embedding model occupied about 5.8 GB at SWEGA's 32K Ollama context (about 2.9 GB during an 8K benchmark projection). These are single-machine operational observations, not general performance guarantees.
