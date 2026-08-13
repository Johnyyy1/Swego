import { extname } from "node:path";

import ts from "typescript";

import type {
  ParsedSourceExport,
  ParsedSourceRelationship,
  SourceRelationshipExtractor,
  SourceRelationshipParseInput,
  SourceRelationshipParseResult,
} from "./source-relationships";

export class TypeScriptSourceRelationshipExtractor implements SourceRelationshipExtractor {
  readonly id = "typescript_compiler_relationships_v2";

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
    const exports: ParsedSourceExport[] = [];
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
            importedName: null,
            localName: null,
            exposedName: null,
            bindingKind: "side_effect",
            isTypeOnly: false,
            sourceSymbol: null,
            line,
          });
          continue;
        }
        if (clause.name) {
          relationships.push({
            relationshipType: "imports",
            moduleSpecifier,
            importedName: "default",
            localName: clause.name.text,
            exposedName: null,
            bindingKind: "default",
            isTypeOnly: clause.isTypeOnly,
            sourceSymbol: clause.name.text,
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
            importedName: null,
            localName: clause.namedBindings.name.text,
            exposedName: null,
            bindingKind: "namespace",
            isTypeOnly: clause.isTypeOnly,
            sourceSymbol: clause.namedBindings.name.text,
            line,
          });
        } else if (clause.namedBindings) {
          for (const element of clause.namedBindings.elements) {
            relationships.push({
              relationshipType: "imports",
              moduleSpecifier,
              importedName: element.propertyName?.text ?? element.name.text,
              localName: element.name.text,
              exposedName: null,
              bindingKind: "named",
              isTypeOnly: clause.isTypeOnly || element.isTypeOnly,
              sourceSymbol: element.name.text,
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
              importedName: element.propertyName?.text ?? element.name.text,
              localName: null,
              exposedName: element.name.text,
              bindingKind: "named",
              isTypeOnly: statement.isTypeOnly || element.isTypeOnly,
              sourceSymbol: element.name.text,
              line,
            });
          }
        } else if (
          statement.exportClause &&
          ts.isNamespaceExport(statement.exportClause)
        ) {
          relationships.push({
            relationshipType: "reexports",
            moduleSpecifier,
            importedName: null,
            localName: null,
            exposedName: statement.exportClause.name.text,
            bindingKind: "namespace",
            isTypeOnly: statement.isTypeOnly,
            sourceSymbol: statement.exportClause.name.text,
            line,
          });
        } else {
          relationships.push({
            relationshipType: "reexports",
            moduleSpecifier,
            importedName: null,
            localName: null,
            exposedName: null,
            bindingKind: "export_star",
            isTypeOnly: statement.isTypeOnly,
            sourceSymbol: null,
            line,
          });
        }
      }
      collectLocalExports(statement, sourceFile, exports);
    }
    return {
      status: "parsed",
      language: dialect.language,
      relationships,
      exports,
    };
  }
}

function collectLocalExports(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  exports: ParsedSourceExport[],
): void {
  const line =
    sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile))
      .line + 1;
  if (
    ts.isExportAssignment(statement) &&
    !statement.isExportEquals &&
    ts.isIdentifier(statement.expression)
  ) {
    exports.push({
      exportedName: "default",
      localName: statement.expression.text,
      line,
    });
    return;
  }
  if (
    ts.isExportDeclaration(statement) &&
    !statement.moduleSpecifier &&
    statement.exportClause &&
    ts.isNamedExports(statement.exportClause)
  ) {
    for (const element of statement.exportClause.elements) {
      exports.push({
        exportedName: element.name.text,
        localName: element.propertyName?.text ?? element.name.text,
        line,
      });
    }
    return;
  }
  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return;
  const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    const localName = statement.name?.text ?? "default";
    exports.push({
      exportedName: isDefault ? "default" : localName,
      localName,
      line,
    });
    return;
  }
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement)
  ) {
    exports.push({
      exportedName: isDefault ? "default" : statement.name.getText(sourceFile),
      localName: statement.name.getText(sourceFile),
      line,
    });
    return;
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      for (const localName of bindingNames(declaration.name)) {
        exports.push({
          exportedName: isDefault ? "default" : localName,
          localName,
          line,
        });
      }
    }
  }
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === kind),
  );
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
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
