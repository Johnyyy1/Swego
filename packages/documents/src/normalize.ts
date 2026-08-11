import { generateMemoryDocument } from "./chunk";
import type {
  CommitDocumentInput,
  GeneratedMemoryDocument,
  IssueCommentDocumentInput,
  IssueDocumentInput,
  PullRequestDocumentInput,
  ReviewDocumentInput,
  SourceCodeDocumentInput,
} from "./types";

export function normalizeIssueDocument(
  input: IssueDocumentInput,
): GeneratedMemoryDocument {
  return generateMemoryDocument({
    ...commonNaturalLanguageFields(input),
    sourceType: "issue",
    parentSourceType: null,
    parentSourceEntityId: null,
    title: input.title,
    content: joinSections([
      issueHeading("Issue", input.number, input.title),
      `State: ${input.state}`,
      authorLine(input.author),
      input.body,
    ]),
    path: null,
    commitSha: null,
  });
}

export function normalizeIssueCommentDocument(
  input: IssueCommentDocumentInput,
): GeneratedMemoryDocument {
  const title = issueHeading("Comment on issue", input.issueNumber, null);
  return generateMemoryDocument({
    ...commonNaturalLanguageFields(input),
    sourceType: "issue_comment",
    parentSourceType: "issue",
    parentSourceEntityId: input.issueId,
    title,
    content: joinSections([title, authorLine(input.author), input.body]),
    path: null,
    commitSha: null,
  });
}

export function normalizePullRequestDocument(
  input: PullRequestDocumentInput,
): GeneratedMemoryDocument {
  return generateMemoryDocument({
    ...commonNaturalLanguageFields(input),
    sourceType: "pull_request",
    parentSourceType: null,
    parentSourceEntityId: null,
    title: input.title,
    content: joinSections([
      issueHeading("Pull request", input.number, input.title),
      `State: ${input.state}`,
      `Branches: ${input.headBranch} -> ${input.baseBranch}`,
      authorLine(input.author),
      input.body,
    ]),
    path: null,
    commitSha: null,
  });
}

export function normalizeReviewDocument(
  input: ReviewDocumentInput,
): GeneratedMemoryDocument {
  const title = issueHeading(
    "Review on pull request",
    input.pullRequestNumber,
    null,
  );
  return generateMemoryDocument({
    ...commonNaturalLanguageFields(input),
    sourceType: "review",
    parentSourceType: "pull_request",
    parentSourceEntityId: input.pullRequestId,
    title,
    content: joinSections([
      title,
      `State: ${input.state}`,
      authorLine(input.author),
      input.body,
    ]),
    path: null,
    commitSha: null,
  });
}

export function normalizeCommitDocument(
  input: CommitDocumentInput,
): GeneratedMemoryDocument {
  const title = input.message.split("\n", 1)[0]?.trim() || input.sha;
  return generateMemoryDocument({
    repositoryId: input.repositoryId,
    sourceType: "commit",
    sourceEntityId: input.sourceEntityId,
    parentSourceType: null,
    parentSourceEntityId: null,
    sourceVersion: input.sha,
    sourceReference: input.sourceReference,
    title,
    content: joinSections([
      `Commit ${input.sha}`,
      `Author: ${input.author}`,
      input.message,
    ]),
    occurredAt: input.authoredAt,
    availableAt: input.committedAt,
    path: null,
    commitSha: input.sha,
  });
}

export function normalizeSourceCodeDocument(
  input: SourceCodeDocumentInput,
): GeneratedMemoryDocument {
  return generateMemoryDocument({
    repositoryId: input.repositoryId,
    sourceType: "source_code",
    sourceEntityId: input.sourceEntityId,
    parentSourceType: null,
    parentSourceEntityId: null,
    sourceVersion: input.commitSha,
    sourceReference: input.sourceReference,
    title: input.path,
    content: input.content,
    occurredAt: input.committedAt,
    availableAt: input.committedAt,
    path: input.path,
    commitSha: input.commitSha,
  });
}

function commonNaturalLanguageFields(
  input:
    | IssueDocumentInput
    | IssueCommentDocumentInput
    | PullRequestDocumentInput
    | ReviewDocumentInput,
) {
  return {
    repositoryId: input.repositoryId,
    sourceEntityId: input.sourceEntityId,
    sourceVersion: input.sourceVersion,
    sourceReference: input.sourceReference,
    occurredAt: input.occurredAt,
    availableAt: input.availableAt,
  };
}

function issueHeading(
  label: string,
  number: number | null,
  title: string | null,
): string {
  return `${label}${number === null ? "" : ` #${number}`}${title ? `: ${title}` : ""}`;
}

function authorLine(author: string | null): string | null {
  return author ? `Author: ${author}` : null;
}

function joinSections(sections: readonly (string | null)[]): string {
  return sections
    .map((section) => section?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}
