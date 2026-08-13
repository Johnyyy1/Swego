import type { SourceRelationshipType } from "@swega/shared";

export const sourceRelationshipBindingKinds = [
  "named",
  "default",
  "namespace",
  "side_effect",
  "export_star",
] as const;

export type SourceRelationshipBindingKind =
  (typeof sourceRelationshipBindingKinds)[number];

export interface SourceRelationshipParseInput {
  path: string;
  content: string;
}

export interface ParsedSourceRelationship {
  relationshipType: SourceRelationshipType;
  moduleSpecifier: string;
  importedName: string | null;
  localName: string | null;
  exposedName: string | null;
  bindingKind: SourceRelationshipBindingKind;
  isTypeOnly: boolean;
  /** Backward-compatible source-side binding or exposed export name. */
  sourceSymbol: string | null;
  line: number;
}

export interface ParsedSourceExport {
  exportedName: string;
  localName: string;
  line: number;
}

export type SourceRelationshipParseResult =
  | { status: "unsupported"; language: null }
  | { status: "failed"; language: string; reason: string }
  | {
      status: "parsed";
      language: string;
      relationships: readonly ParsedSourceRelationship[];
      exports: readonly ParsedSourceExport[];
    };

/** Extracts syntax-proven relationships without resolving a project or executing code. */
export interface SourceRelationshipExtractor {
  readonly id: string;
  extract(input: SourceRelationshipParseInput): SourceRelationshipParseResult;
}
