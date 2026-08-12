import type { MemorySourceType, RepositoryId } from "@swega/shared";

import type { SourceSymbolKind } from "./source-structure";

export type { MemorySourceType } from "@swega/shared";

export interface MemoryDocumentInput {
  repositoryId: RepositoryId;
  sourceType: MemorySourceType;
  sourceEntityId: string;
  parentSourceType: MemorySourceType | null;
  parentSourceEntityId: string | null;
  sourceVersion: string;
  sourceReference: string;
  title: string | null;
  content: string;
  occurredAt: Date;
  availableAt: Date;
  path: string | null;
  commitSha: string | null;
}

export interface MemoryDocument extends MemoryDocumentInput {
  id: string;
  contentHash: string;
  chunkingStrategy:
    "natural_language_v1" | "source_code_structural_v1" | "source_code_v1";
}

export interface MemoryDocumentChunk {
  id: string;
  documentId: string;
  repositoryId: RepositoryId;
  sourceType: MemorySourceType;
  sourceEntityId: string;
  parentSourceType: MemorySourceType | null;
  parentSourceEntityId: string | null;
  sourceReference: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  occurredAt: Date;
  availableAt: Date;
  path: string | null;
  commitSha: string | null;
  startLine: number | null;
  endLine: number | null;
  language: string | null;
  symbolId: string | null;
  symbolName: string | null;
  symbolKind: SourceSymbolKind | null;
  parentSymbol: string | null;
  symbolPart: number | null;
  symbolPartCount: number | null;
}

export interface GeneratedMemoryDocument {
  document: MemoryDocument;
  chunks: readonly MemoryDocumentChunk[];
}

export interface NaturalLanguageSourceInput {
  repositoryId: RepositoryId;
  sourceEntityId: string;
  sourceVersion: string;
  sourceReference: string;
  occurredAt: Date;
  availableAt: Date;
  title: string;
  body: string | null;
  author: string | null;
}

export interface IssueDocumentInput extends NaturalLanguageSourceInput {
  number: number | null;
  state: string;
}

export interface IssueCommentDocumentInput extends Omit<
  NaturalLanguageSourceInput,
  "title"
> {
  issueId: string;
  issueNumber: number | null;
}

export interface PullRequestDocumentInput extends NaturalLanguageSourceInput {
  number: number | null;
  state: string;
  baseBranch: string;
  headBranch: string;
}

export interface ReviewDocumentInput extends Omit<
  NaturalLanguageSourceInput,
  "title"
> {
  pullRequestId: string;
  pullRequestNumber: number | null;
  state: string;
}

export interface CommitDocumentInput {
  repositoryId: RepositoryId;
  sourceEntityId: string;
  sha: string;
  message: string;
  author: string;
  authoredAt: Date;
  committedAt: Date;
  sourceReference: string;
}

export interface SourceCodeDocumentInput {
  repositoryId: RepositoryId;
  sourceEntityId: string;
  path: string;
  commitSha: string;
  committedAt: Date;
  content: string;
  sourceReference: string;
  language?: string | null;
}
