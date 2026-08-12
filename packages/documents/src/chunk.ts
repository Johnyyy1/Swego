import { createHash } from "node:crypto";

import type {
  GeneratedMemoryDocument,
  MemoryDocument,
  MemoryDocumentChunk,
  MemoryDocumentInput,
} from "./types";
import type {
  ParsedSourceSymbol,
  SourceStructureParser,
  SourceSymbolKind,
} from "./source-structure";
import { typeScriptSourceStructureParser } from "./typescript-structure";

const NATURAL_LANGUAGE_MAX_CHARACTERS = 1_800;
const SOURCE_CODE_MAX_CHARACTERS = 12_000;
const SOURCE_CODE_MAX_LINES = 120;
const SOURCE_CODE_OVERLAP_LINES = 20;
const STRUCTURAL_PART_LABEL_CHARACTER_RESERVE = 32;

interface ChunkContent {
  content: string;
  startLine: number | null;
  endLine: number | null;
  language: string | null;
  symbolName: string | null;
  symbolKind: SourceSymbolKind | null;
  parentSymbol: string | null;
  symbolStartLine: number | null;
  symbolEndLine: number | null;
  symbolPart: number | null;
  symbolPartCount: number | null;
}

export interface GenerateMemoryDocumentOptions {
  sourceLanguage?: string | null;
  structureParser?: SourceStructureParser;
}

export function generateMemoryDocument(
  input: MemoryDocumentInput,
  options: GenerateMemoryDocumentOptions = {},
): GeneratedMemoryDocument {
  validateInput(input);
  const chunking =
    input.sourceType === "source_code"
      ? chunkSourceCode(
          input.content,
          input.path ?? "",
          options.sourceLanguage ?? null,
          options.structureParser ?? typeScriptSourceStructureParser,
        )
      : {
          strategy: "natural_language_v1" as const,
          chunks: chunkNaturalLanguage(input.content),
        };
  const id = hashParts([
    "document_v1",
    input.repositoryId,
    input.sourceType,
    input.sourceEntityId,
    input.sourceVersion,
  ]);
  const document: MemoryDocument = {
    ...input,
    id,
    contentHash: hashText(input.content),
    chunkingStrategy: chunking.strategy,
  };

  return {
    document,
    chunks: chunking.chunks.map((chunk, chunkIndex) =>
      createChunk(document, chunk, chunkIndex),
    ),
  };
}

function createChunk(
  document: MemoryDocument,
  chunk: ChunkContent,
  chunkIndex: number,
): MemoryDocumentChunk {
  const contentHash = hashText(chunk.content);
  return {
    id: hashParts([
      "chunk_v1",
      document.id,
      document.chunkingStrategy,
      String(chunkIndex),
      contentHash,
    ]),
    documentId: document.id,
    repositoryId: document.repositoryId,
    sourceType: document.sourceType,
    sourceEntityId: document.sourceEntityId,
    parentSourceType: document.parentSourceType,
    parentSourceEntityId: document.parentSourceEntityId,
    sourceReference: document.sourceReference,
    chunkIndex,
    content: chunk.content,
    contentHash,
    occurredAt: document.occurredAt,
    availableAt: document.availableAt,
    path: document.path,
    commitSha: document.commitSha,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    language: chunk.language,
    symbolId:
      chunk.symbolKind &&
      chunk.symbolStartLine !== null &&
      chunk.symbolEndLine !== null
        ? hashParts([
            "symbol_v1",
            document.id,
            chunk.language ?? "",
            chunk.symbolKind,
            chunk.symbolName ?? "",
            chunk.parentSymbol ?? "",
            String(chunk.symbolStartLine),
            String(chunk.symbolEndLine),
          ])
        : null,
    symbolName: chunk.symbolName,
    symbolKind: chunk.symbolKind,
    parentSymbol: chunk.parentSymbol,
    symbolPart: chunk.symbolPart,
    symbolPartCount: chunk.symbolPartCount,
  };
}

function chunkNaturalLanguage(content: string): ChunkContent[] {
  const paragraphs = content
    .trim()
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitLongText(paragraph));
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= NATURAL_LANGUAGE_MAX_CHARACTERS) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
    }
    current = paragraph;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.map((chunk) => ({
    content: chunk,
    startLine: null,
    endLine: null,
    ...emptyStructuralMetadata(null),
  }));
}

function splitLongText(text: string): string[] {
  if (text.length <= NATURAL_LANGUAGE_MAX_CHARACTERS) {
    return [text];
  }

  const segments: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + NATURAL_LANGUAGE_MAX_CHARACTERS, text.length);
    if (end < text.length) {
      const whitespace = text.lastIndexOf(" ", end);
      if (whitespace > offset) {
        end = whitespace;
      }
    }
    segments.push(text.slice(offset, end).trim());
    offset = end;
    while (text[offset] === " ") {
      offset += 1;
    }
  }
  return segments.filter(Boolean);
}

function chunkSourceCode(
  content: string,
  path: string,
  sourceLanguage: string | null,
  parser: SourceStructureParser,
): {
  strategy: "source_code_structural_v1" | "source_code_v1";
  chunks: ChunkContent[];
} {
  try {
    const parsed = parser.parse({ path, content });
    if (parsed.status === "parsed" && parsed.symbols.length > 0) {
      return {
        strategy: "source_code_structural_v1",
        chunks: chunkParsedSource(content, parsed.language, parsed.symbols),
      };
    }
    return {
      strategy: "source_code_v1",
      chunks: chunkSourceCodeText(
        content,
        parsed.status === "unsupported" ? sourceLanguage : parsed.language,
      ),
    };
  } catch {
    // Parser adapters are optional enrichment. Unexpected provider failures are
    // intentionally contained so repository-memory construction stays safe.
    return {
      strategy: "source_code_v1",
      chunks: chunkSourceCodeText(content, sourceLanguage),
    };
  }
}

function chunkParsedSource(
  content: string,
  language: string,
  symbols: readonly ParsedSourceSymbol[],
): ChunkContent[] {
  const lineStarts = sourceLineStarts(content);
  const units: StructuralUnit[] = symbols.map((symbol) => ({
    startOffset: symbol.startOffset,
    endOffset: symbol.endOffset,
    language,
    symbolName: symbol.symbolName,
    symbolKind: symbol.symbolKind,
    parentSymbol: symbol.parentSymbol,
    symbolStartLine: symbol.startLine,
    symbolEndLine: symbol.endLine,
    signature: symbol.signature,
  }));
  const coverages = symbols
    .filter((symbol) => symbol.topLevel)
    .map((symbol) => ({
      start: symbol.coverageStartOffset,
      end: symbol.coverageEndOffset,
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let cursor = 0;
  for (const coverage of coverages) {
    if (coverage.start > cursor) {
      units.push(moduleUnit(language, cursor, coverage.start, lineStarts));
    }
    cursor = Math.max(cursor, coverage.end);
  }
  if (cursor < content.length) {
    units.push(moduleUnit(language, cursor, content.length, lineStarts));
  }

  return units
    .filter((unit) => content.slice(unit.startOffset, unit.endOffset).trim())
    .sort(
      (left, right) =>
        left.startOffset - right.startOffset ||
        right.endOffset - left.endOffset ||
        left.symbolKind.localeCompare(right.symbolKind) ||
        (left.symbolName ?? "").localeCompare(right.symbolName ?? ""),
    )
    .flatMap((unit) => splitStructuralUnit(content, unit, lineStarts));
}

interface StructuralUnit {
  startOffset: number;
  endOffset: number;
  language: string;
  symbolName: string | null;
  symbolKind: SourceSymbolKind;
  parentSymbol: string | null;
  symbolStartLine: number;
  symbolEndLine: number;
  signature: string;
}

function moduleUnit(
  language: string,
  startOffset: number,
  endOffset: number,
  lineStarts: readonly number[],
): StructuralUnit {
  return {
    startOffset,
    endOffset,
    language,
    symbolName: null,
    symbolKind: "module",
    parentSymbol: null,
    symbolStartLine: lineAtOffset(lineStarts, startOffset),
    symbolEndLine: lineAtOffset(
      lineStarts,
      Math.max(startOffset, endOffset - 1),
    ),
    signature: "",
  };
}

function splitStructuralUnit(
  source: string,
  unit: StructuralUnit,
  lineStarts: readonly number[],
): ChunkContent[] {
  const range = trimRange(source, unit.startOffset, unit.endOffset);
  if (!range) {
    return [];
  }
  const rawContent = source.slice(range.start, range.end);
  const startLine = lineAtOffset(lineStarts, range.start);
  const lineCount = rawContent.split("\n").length;
  const needsSubdivision =
    rawContent.length > SOURCE_CODE_MAX_CHARACTERS ||
    lineCount > SOURCE_CODE_MAX_LINES;
  const context = structuralContext(unit);
  const parts = needsSubdivision
    ? splitSourceLines(
        rawContent,
        startLine,
        Math.max(
          1,
          SOURCE_CODE_MAX_CHARACTERS -
            context.length -
            STRUCTURAL_PART_LABEL_CHARACTER_RESERVE,
        ),
        SOURCE_CODE_MAX_LINES,
        false,
      )
    : [{ content: rawContent, startLine, endLine: startLine + lineCount - 1 }];

  return parts.map((part, index) => ({
    content:
      parts.length > 1
        ? `${context} (part ${index + 1}/${parts.length})\n${part.content}`
        : part.content,
    startLine: part.startLine,
    endLine: part.endLine,
    language: unit.language,
    symbolName: unit.symbolName,
    symbolKind: unit.symbolKind,
    parentSymbol: unit.parentSymbol,
    symbolStartLine: unit.symbolStartLine,
    symbolEndLine: unit.symbolEndLine,
    symbolPart: index + 1,
    symbolPartCount: parts.length,
  }));
}

function structuralContext(unit: StructuralUnit): string {
  const identity = [
    unit.symbolKind,
    unit.symbolName,
    unit.parentSymbol ? `in ${unit.parentSymbol}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return `// SWEGA structural context: ${identity}${unit.signature ? ` | ${unit.signature}` : ""}`;
}

function chunkSourceCodeText(
  content: string,
  language: string | null,
): ChunkContent[] {
  const lines = content.split("\n");
  const chunks: ChunkContent[] = [];
  let start = 0;

  while (start < lines.length) {
    const firstLine = lines[start] ?? "";
    if (firstLine.length > SOURCE_CODE_MAX_CHARACTERS) {
      for (
        let offset = 0;
        offset < firstLine.length;
        offset += SOURCE_CODE_MAX_CHARACTERS
      ) {
        chunks.push({
          content: firstLine.slice(offset, offset + SOURCE_CODE_MAX_CHARACTERS),
          startLine: start + 1,
          endLine: start + 1,
          ...emptyStructuralMetadata(language),
        });
      }
      start += 1;
      continue;
    }

    let end = start;
    let characterCount = 0;
    while (end < lines.length && end - start < SOURCE_CODE_MAX_LINES) {
      const lineLength = (lines[end]?.length ?? 0) + 1;
      if (
        end > start &&
        characterCount + lineLength > SOURCE_CODE_MAX_CHARACTERS
      ) {
        break;
      }
      characterCount += lineLength;
      end += 1;
    }

    if (end === start) {
      end += 1;
    }
    chunks.push({
      content: lines.slice(start, end).join("\n"),
      startLine: start + 1,
      endLine: end,
      ...emptyStructuralMetadata(language),
    });

    if (end >= lines.length) {
      break;
    }
    start = Math.max(start + 1, end - SOURCE_CODE_OVERLAP_LINES);
  }

  return chunks.filter((chunk) => chunk.content.length > 0);
}

function splitSourceLines(
  content: string,
  firstLineNumber: number,
  maxCharacters: number,
  maxLines: number,
  overlap: boolean,
): Array<{ content: string; startLine: number; endLine: number }> {
  const lines = content.split("\n");
  const chunks: Array<{ content: string; startLine: number; endLine: number }> =
    [];
  let start = 0;
  while (start < lines.length) {
    const firstLine = lines[start] ?? "";
    if (firstLine.length > maxCharacters) {
      for (let offset = 0; offset < firstLine.length; offset += maxCharacters) {
        chunks.push({
          content: firstLine.slice(offset, offset + maxCharacters),
          startLine: firstLineNumber + start,
          endLine: firstLineNumber + start,
        });
      }
      start += 1;
      continue;
    }
    let end = start;
    let characterCount = 0;
    while (end < lines.length && end - start < maxLines) {
      const lineLength = (lines[end]?.length ?? 0) + 1;
      if (end > start && characterCount + lineLength > maxCharacters) {
        break;
      }
      characterCount += lineLength;
      end += 1;
    }
    chunks.push({
      content: lines.slice(start, end).join("\n"),
      startLine: firstLineNumber + start,
      endLine: firstLineNumber + end - 1,
    });
    if (end >= lines.length) {
      break;
    }
    start = overlap
      ? Math.max(start + 1, end - SOURCE_CODE_OVERLAP_LINES)
      : end;
  }
  return chunks.filter((chunk) => chunk.content.length > 0);
}

function sourceLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineAtOffset(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((lineStarts[middle] ?? 0) <= offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return Math.max(1, low);
}

function trimRange(
  content: string,
  startOffset: number,
  endOffset: number,
): { start: number; end: number } | null {
  let start = startOffset;
  let end = endOffset;
  while (start < end && /\s/u.test(content[start] ?? "")) {
    start += 1;
  }
  while (end > start && /\s/u.test(content[end - 1] ?? "")) {
    end -= 1;
  }
  return start < end ? { start, end } : null;
}

function emptyStructuralMetadata(language: string | null) {
  return {
    language,
    symbolName: null,
    symbolKind: null,
    parentSymbol: null,
    symbolStartLine: null,
    symbolEndLine: null,
    symbolPart: null,
    symbolPartCount: null,
  } as const;
}

function validateInput(input: MemoryDocumentInput): void {
  if (!input.repositoryId || !input.sourceEntityId || !input.sourceVersion) {
    throw new Error(
      "A memory document requires repository and source identity",
    );
  }
  if (!input.sourceReference) {
    throw new Error("A memory document requires an original source reference");
  }
  if (
    (input.parentSourceType === null) !==
    (input.parentSourceEntityId === null)
  ) {
    throw new Error(
      "Parent source type and entity ID must be provided together",
    );
  }
  if (
    Number.isNaN(input.occurredAt.getTime()) ||
    Number.isNaN(input.availableAt.getTime())
  ) {
    throw new Error("A memory document requires valid temporal metadata");
  }
  if (!input.content.trim()) {
    throw new Error("A memory document requires searchable content");
  }
  if (input.sourceType === "source_code" && (!input.path || !input.commitSha)) {
    throw new Error("Source code documents require a path and commit SHA");
  }
  if (input.sourceType === "commit" && !input.commitSha) {
    throw new Error("Commit documents require a commit SHA");
  }
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashParts(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(part.length));
    hash.update(":");
    hash.update(part);
  }
  return hash.digest("hex");
}
