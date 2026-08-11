import { createHash } from "node:crypto";

import type {
  GeneratedMemoryDocument,
  MemoryDocument,
  MemoryDocumentChunk,
  MemoryDocumentInput,
} from "./types";

const NATURAL_LANGUAGE_MAX_CHARACTERS = 1_800;
const SOURCE_CODE_MAX_CHARACTERS = 12_000;
const SOURCE_CODE_MAX_LINES = 120;
const SOURCE_CODE_OVERLAP_LINES = 20;

interface ChunkContent {
  content: string;
  startLine: number | null;
  endLine: number | null;
}

export function generateMemoryDocument(
  input: MemoryDocumentInput,
): GeneratedMemoryDocument {
  validateInput(input);
  const chunkingStrategy =
    input.sourceType === "source_code"
      ? "source_code_v1"
      : "natural_language_v1";
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
    chunkingStrategy,
  };
  const rawChunks =
    input.sourceType === "source_code"
      ? chunkSourceCode(input.content)
      : chunkNaturalLanguage(input.content);

  return {
    document,
    chunks: rawChunks.map((chunk, chunkIndex) =>
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

function chunkSourceCode(content: string): ChunkContent[] {
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
    });

    if (end >= lines.length) {
      break;
    }
    start = Math.max(start + 1, end - SOURCE_CODE_OVERLAP_LINES);
  }

  return chunks.filter((chunk) => chunk.content.length > 0);
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
