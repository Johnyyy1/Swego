import type { SourceRelationshipType } from "@swega/shared";

export interface SourceRelationshipParseInput {
  path: string;
  content: string;
}

export interface ParsedSourceRelationship {
  relationshipType: SourceRelationshipType;
  moduleSpecifier: string;
  sourceSymbol: string | null;
  targetSymbol: string | null;
  line: number;
}

export type SourceRelationshipParseResult =
  | { status: "unsupported"; language: null }
  | { status: "failed"; language: string; reason: string }
  | {
      status: "parsed";
      language: string;
      relationships: readonly ParsedSourceRelationship[];
    };

/** Extracts syntax-proven relationships without resolving a project or executing code. */
export interface SourceRelationshipExtractor {
  readonly id: string;
  extract(input: SourceRelationshipParseInput): SourceRelationshipParseResult;
}
