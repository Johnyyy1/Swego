import { describe, expect, test } from "bun:test";

import {
  normalizeCommitDocument,
  normalizeIssueCommentDocument,
  normalizeIssueDocument,
  normalizeSourceCodeDocument,
} from "./index";

const repositoryOne = "123e4567-e89b-42d3-a456-426614174000";
const repositoryTwo = "223e4567-e89b-42d3-a456-426614174000";
const sourceEntityId = "323e4567-e89b-42d3-a456-426614174000";

describe("repository-memory documents", () => {
  test("keeps every chunk associated with its repository and source", () => {
    const first = issueDocument(repositoryOne);
    const second = issueDocument(repositoryTwo);

    expect(first.document.id).not.toBe(second.document.id);
    expect(first.chunks.length).toBeGreaterThan(0);
    for (const chunk of first.chunks) {
      expect(chunk.repositoryId).toBe(repositoryOne);
      expect(chunk.documentId).toBe(first.document.id);
      expect(chunk.sourceType).toBe("issue");
      expect(chunk.sourceEntityId).toBe(sourceEntityId);
      expect(chunk.sourceReference).toBe("provider:github:issue:42");
    }
  });

  test("generates stable document and chunk IDs for idempotent re-indexing", () => {
    const first = issueDocument(repositoryOne);
    const second = issueDocument(repositoryOne);
    const storedDocuments = new Map([
      [first.document.id, first.document],
      [second.document.id, second.document],
    ]);
    const storedChunks = new Map(
      [...first.chunks, ...second.chunks].map((chunk) => [chunk.id, chunk]),
    );

    expect(second).toEqual(first);
    expect(storedDocuments.size).toBe(1);
    expect(storedChunks.size).toBe(first.chunks.length);
  });

  test("preserves normalized parent relationships on comments", () => {
    const issueId = "423e4567-e89b-42d3-a456-426614174000";
    const createdAt = new Date("2025-03-01T10:00:00.000Z");
    const comment = normalizeIssueCommentDocument({
      repositoryId: repositoryOne,
      sourceEntityId,
      issueId,
      sourceVersion: createdAt.toISOString(),
      sourceReference: "provider:github:issue_comment:99",
      occurredAt: createdAt,
      availableAt: createdAt,
      issueNumber: 42,
      body: "This comment remains connected to its normalized issue.",
      author: "reviewer",
    });

    expect(comment.document).toMatchObject({
      parentSourceType: "issue",
      parentSourceEntityId: issueId,
    });
    expect(comment.chunks[0]).toMatchObject({
      parentSourceType: "issue",
      parentSourceEntityId: issueId,
    });
  });

  test("preserves occurred and safe availability timestamps on every chunk", () => {
    const createdAt = new Date("2025-03-01T10:00:00.000Z");
    const updatedAt = new Date("2025-03-20T15:30:00.000Z");
    const generated = normalizeIssueDocument({
      repositoryId: repositoryOne,
      sourceEntityId,
      sourceVersion: updatedAt.toISOString(),
      sourceReference: "provider:github:issue:42",
      occurredAt: createdAt,
      availableAt: updatedAt,
      number: 42,
      title: "Temporal correctness",
      body: "This body represents the updated provider snapshot.",
      author: null,
      state: "open",
    });

    expect(generated.document.occurredAt).toEqual(createdAt);
    expect(generated.document.availableAt).toEqual(updatedAt);
    for (const chunk of generated.chunks) {
      expect(chunk.occurredAt).toEqual(createdAt);
      expect(chunk.availableAt).toEqual(updatedAt);
    }
  });

  test("uses commit time as the availability boundary for immutable Git data", () => {
    const authoredAt = new Date("2025-03-14T23:55:00.000Z");
    const committedAt = new Date("2025-03-15T00:05:00.000Z");
    const commit = normalizeCommitDocument({
      repositoryId: repositoryOne,
      sourceEntityId,
      sha: "a".repeat(40),
      message: "Implement temporal indexing",
      author: "SWEGA Test",
      authoredAt,
      committedAt,
      sourceReference: `git:${"a".repeat(40)}`,
    });

    expect(commit.document.occurredAt).toEqual(authoredAt);
    expect(commit.document.availableAt).toEqual(committedAt);
    expect(commit.chunks[0]?.availableAt).toEqual(committedAt);
  });

  test("conservatively chunks source code by lines with provenance", () => {
    const content = Array.from(
      { length: 150 },
      (_, index) => `export const value${index + 1} = ${index + 1};`,
    ).join("\n");
    const generated = normalizeSourceCodeDocument({
      repositoryId: repositoryOne,
      sourceEntityId,
      path: "src/constants.ts",
      commitSha: "b".repeat(40),
      committedAt: new Date("2025-03-10T12:00:00.000Z"),
      content,
      sourceReference: `git:${"b".repeat(40)}:src/constants.ts`,
    });

    expect(generated.chunks.length).toBeGreaterThan(1);
    expect(generated.chunks[0]).toMatchObject({
      path: "src/constants.ts",
      commitSha: "b".repeat(40),
      startLine: 1,
      endLine: 120,
    });
    expect(generated.chunks[1]?.startLine).toBe(101);
  });

  test("bounds unusually long source lines", () => {
    const generated = normalizeSourceCodeDocument({
      repositoryId: repositoryOne,
      sourceEntityId,
      path: "generated.txt",
      commitSha: "c".repeat(40),
      committedAt: new Date("2025-03-10T12:00:00.000Z"),
      content: "x".repeat(25_000),
      sourceReference: `git:${"c".repeat(40)}:generated.txt`,
    });

    expect(generated.chunks).toHaveLength(3);
    expect(
      generated.chunks.every((chunk) => chunk.content.length <= 12_000),
    ).toBe(true);
  });
});

function issueDocument(repositoryId: string) {
  const occurredAt = new Date("2025-03-01T10:00:00.000Z");
  return normalizeIssueDocument({
    repositoryId,
    sourceEntityId,
    sourceVersion: occurredAt.toISOString(),
    sourceReference: "provider:github:issue:42",
    occurredAt,
    availableAt: occurredAt,
    number: 42,
    title: "Repository isolation",
    body: "A deterministic document used in repository isolation tests.",
    author: "tester",
    state: "open",
  });
}
