import { extname } from "node:path";

import ts from "typescript";

import type {
  ParsedSourceRelationship,
  SourceRelationshipExtractor,
  SourceRelationshipParseInput,
  SourceRelationshipParseResult,
} from "./source-relationships";

export class TypeScriptSourceRelationshipExtractor implements SourceRelationshipExtractor {
  readonly id = "typescript_compiler_relationships_v1";

  extract(input: SourceRelationshipParseInput): SourceRelationshipParseResult {
    const dialect = dialectForPath(input.path);
    if (!dialect) return { status: "unsupported", language: null };
    const sourceFile = ts.createSourceFile(
      input.path,
      input.content,
      ts.ScriptTarget.Latest,
      true,
      dialect.scriptKind,
    );
    if (hasParseError(sourceFile)) {
      return {
        status: "failed",
        language: dialect.language,
        reason: "syntax_error",
      };
    }

    const relationships: ParsedSourceRelationship[] = [];
    for (const statement of sourceFile.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const moduleSpecifier = statement.moduleSpecifier.text;
        const line =
          sourceFile.getLineAndCharacterOfPosition(
            statement.getStart(sourceFile),
          ).line + 1;
        const clause = statement.importClause;
        if (!clause) {
          relationships.push({
            relationshipType: "imports",
            moduleSpecifier,
            sourceSymbol: null,
            targetSymbol: null,
            line,
          });
          continue;
        }
        if (clause.name) {
          relationships.push({
            relationshipType: "imports",
            moduleSpecifier,
            sourceSymbol: clause.name.text,
            targetSymbol: "default",
            line,
          });
        }
        if (
          clause.namedBindings &&
          ts.isNamespaceImport(clause.namedBindings)
        ) {
          relationships.push({
            relationshipType: "imports",
            moduleSpecifier,
            sourceSymbol: clause.namedBindings.name.text,
            targetSymbol: null,
            line,
          });
        } else if (clause.namedBindings) {
          for (const element of clause.namedBindings.elements) {
            relationships.push({
              relationshipType: "imports",
              moduleSpecifier,
              sourceSymbol: element.name.text,
              targetSymbol: element.propertyName?.text ?? element.name.text,
              line,
            });
          }
        }
      } else if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const moduleSpecifier = statement.moduleSpecifier.text;
        const line =
          sourceFile.getLineAndCharacterOfPosition(
            statement.getStart(sourceFile),
          ).line + 1;
        if (
          statement.exportClause &&
          ts.isNamedExports(statement.exportClause)
        ) {
          for (const element of statement.exportClause.elements) {
            relationships.push({
              relationshipType: "reexports",
              moduleSpecifier,
              sourceSymbol: element.name.text,
              targetSymbol: element.propertyName?.text ?? element.name.text,
              line,
            });
          }
        } else {
          relationships.push({
            relationshipType: "reexports",
            moduleSpecifier,
            sourceSymbol: null,
            targetSymbol: null,
            line,
          });
        }
      }
    }
    return { status: "parsed", language: dialect.language, relationships };
  }
}

function hasParseError(sourceFile: ts.SourceFile): boolean {
  let failed = false;
  const visit = (node: ts.Node): void => {
    if ((node.flags & ts.NodeFlags.ThisNodeHasError) !== 0) {
      failed = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return failed;
}

function dialectForPath(
  path: string,
): { language: string; scriptKind: ts.ScriptKind } | null {
  switch (extname(path).toLowerCase()) {
    case ".ts":
    case ".mts":
    case ".cts":
      return { language: "TypeScript", scriptKind: ts.ScriptKind.TS };
    case ".tsx":
      return { language: "TSX", scriptKind: ts.ScriptKind.TSX };
    case ".js":
    case ".mjs":
    case ".cjs":
      return { language: "JavaScript", scriptKind: ts.ScriptKind.JS };
    case ".jsx":
      return { language: "JSX", scriptKind: ts.ScriptKind.JSX };
    default:
      return null;
  }
}

export const typeScriptSourceRelationshipExtractor =
  new TypeScriptSourceRelationshipExtractor();
