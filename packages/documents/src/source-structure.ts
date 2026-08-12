import type { SourceSymbolKind } from "@swega/shared";

export type { SourceSymbolKind } from "@swega/shared";

export interface SourceStructureParseInput {
  path: string;
  content: string;
}

export interface ParsedSourceSymbol {
  language: string;
  symbolName: string;
  symbolKind: SourceSymbolKind;
  parentSymbol: string | null;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  signature: string;
  topLevel: boolean;
  coverageStartOffset: number;
  coverageEndOffset: number;
}

export type SourceStructureParseResult =
  | { status: "unsupported"; language: null }
  | { status: "failed"; language: string; reason: string }
  | {
      status: "parsed";
      language: string;
      symbols: readonly ParsedSourceSymbol[];
    };

/**
 * Parses one source file into language-specific structural units. Implementors
 * inspect text only; they must not resolve imports or execute repository code.
 */
export interface SourceStructureParser {
  readonly id: string;
  parse(input: SourceStructureParseInput): SourceStructureParseResult;
}
