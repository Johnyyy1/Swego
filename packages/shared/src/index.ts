import { z } from "zod";

export const repositoryIdSchema = z.string().uuid();
export type RepositoryId = z.infer<typeof repositoryIdSchema>;

export const repositoryLocatorSchema = z.object({
  provider: z.string().min(1),
  providerId: z.string().min(1).optional(),
  owner: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
});

export type RepositoryLocator = z.infer<typeof repositoryLocatorSchema>;

export const memorySourceTypes = [
  "issue",
  "issue_comment",
  "pull_request",
  "review",
  "commit",
  "source_code",
] as const;

export type MemorySourceType = (typeof memorySourceTypes)[number];

export const sourceSymbolKinds = [
  "class",
  "enum",
  "function",
  "interface",
  "method",
  "module",
  "property",
  "type",
  "variable",
] as const;

export type SourceSymbolKind = (typeof sourceSymbolKinds)[number];

export const EMBEDDING_DIMENSIONS = 512;
