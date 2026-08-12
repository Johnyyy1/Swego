import { extname } from "node:path";

import ts from "typescript";

import type {
  ParsedSourceSymbol,
  SourceStructureParseInput,
  SourceStructureParseResult,
  SourceStructureParser,
  SourceSymbolKind,
} from "./source-structure";

interface TypeScriptDialect {
  language: "JavaScript" | "JSX" | "TypeScript" | "TSX";
  scriptKind: ts.ScriptKind;
}

export class TypeScriptSourceStructureParser implements SourceStructureParser {
  readonly id = "typescript_compiler_api_v1";

  parse(input: SourceStructureParseInput): SourceStructureParseResult {
    const dialect = dialectForPath(input.path);
    if (!dialect) {
      return { status: "unsupported", language: null };
    }

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

    const collector = new TypeScriptSymbolCollector(
      sourceFile,
      dialect.language,
    );
    return {
      status: "parsed",
      language: dialect.language,
      symbols: collector.collect(),
    };
  }
}

class TypeScriptSymbolCollector {
  private readonly symbols: ParsedSourceSymbol[] = [];

  constructor(
    private readonly sourceFile: ts.SourceFile,
    private readonly language: TypeScriptDialect["language"],
  ) {}

  collect(): readonly ParsedSourceSymbol[] {
    for (const statement of this.sourceFile.statements) {
      this.visit(statement, null, true);
    }
    return this.symbols.sort(compareSymbols);
  }

  private visit(
    node: ts.Node,
    parentSymbol: string | null,
    topLevel: boolean,
  ): void {
    if (ts.isFunctionDeclaration(node)) {
      const name = node.name?.text ?? "default";
      this.addSymbol(node, "function", name, parentSymbol, topLevel);
      if (node.body) {
        this.visitNested(node.body, name);
      }
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      this.visitClass(node, parentSymbol, topLevel);
      return;
    }
    if (ts.isInterfaceDeclaration(node)) {
      this.addSymbol(node, "interface", node.name.text, parentSymbol, topLevel);
      return;
    }
    if (ts.isTypeAliasDeclaration(node)) {
      this.addSymbol(node, "type", node.name.text, parentSymbol, topLevel);
      return;
    }
    if (ts.isEnumDeclaration(node)) {
      this.addSymbol(node, "enum", node.name.text, parentSymbol, topLevel);
      return;
    }
    if (ts.isModuleDeclaration(node)) {
      const name = propertyNameText(node.name, this.sourceFile);
      this.addSymbol(node, "module", name, parentSymbol, topLevel);
      return;
    }
    if (ts.isVariableStatement(node)) {
      this.visitVariableStatement(node, parentSymbol, topLevel);
      return;
    }

    this.visitNested(node, parentSymbol);
  }

  private visitClass(
    node: ts.ClassLikeDeclaration,
    parentSymbol: string | null,
    topLevel: boolean,
  ): void {
    const name = node.name?.text ?? "default";
    const headerEnd = Math.max(
      node.getStart(this.sourceFile),
      node.members.pos,
    );
    this.addSymbol(node, "class", name, parentSymbol, topLevel, headerEnd);

    for (const member of node.members) {
      if (
        ts.isMethodDeclaration(member) ||
        ts.isGetAccessorDeclaration(member) ||
        ts.isSetAccessorDeclaration(member) ||
        ts.isConstructorDeclaration(member)
      ) {
        const memberName = ts.isConstructorDeclaration(member)
          ? "constructor"
          : propertyNameText(member.name, this.sourceFile);
        this.addSymbol(member, "method", memberName, name, false);
        if (member.body) {
          this.visitNested(member.body, memberName);
        }
        continue;
      }
      if (ts.isPropertyDeclaration(member)) {
        const memberName = propertyNameText(member.name, this.sourceFile);
        const initializer = member.initializer
          ? findFunctionInitializer(member.initializer)
          : null;
        this.addSymbol(
          member,
          initializer ? "method" : "property",
          memberName,
          name,
          false,
        );
        if (initializer?.body) {
          this.visitNested(initializer.body, memberName);
        }
        continue;
      }
      this.visitNested(member, name);
    }
  }

  private visitVariableStatement(
    node: ts.VariableStatement,
    parentSymbol: string | null,
    topLevel: boolean,
  ): void {
    const names = node.declarationList.declarations.flatMap((declaration) =>
      bindingNames(declaration.name),
    );
    const name = names.join(", ") || "anonymous";
    const singleDeclaration =
      node.declarationList.declarations.length === 1
        ? node.declarationList.declarations[0]
        : undefined;
    const initializer = singleDeclaration?.initializer
      ? findFunctionInitializer(singleDeclaration.initializer)
      : null;

    if (topLevel || initializer) {
      this.addSymbol(
        node,
        initializer ? "function" : "variable",
        name,
        parentSymbol,
        topLevel,
      );
    }
    if (initializer?.body) {
      this.visitNested(initializer.body, name);
    }
  }

  private visitNested(node: ts.Node, parentSymbol: string | null): void {
    ts.forEachChild(node, (child) => this.visit(child, parentSymbol, false));
  }

  private addSymbol(
    node: ts.Node,
    symbolKind: SourceSymbolKind,
    symbolName: string,
    parentSymbol: string | null,
    topLevel: boolean,
    contentEndOffset: number = node.end,
  ): void {
    const startOffset = node.getFullStart();
    const endOffset = Math.max(startOffset + 1, contentEndOffset);
    const start = this.sourceFile.getLineAndCharacterOfPosition(startOffset);
    const end = this.sourceFile.getLineAndCharacterOfPosition(endOffset - 1);
    this.symbols.push({
      language: this.language,
      symbolName,
      symbolKind,
      parentSymbol,
      startOffset,
      endOffset,
      startLine: start.line + 1,
      endLine: end.line + 1,
      signature: signatureForNode(node, this.sourceFile),
      topLevel,
      coverageStartOffset: startOffset,
      coverageEndOffset: node.end,
    });
  }
}

function dialectForPath(path: string): TypeScriptDialect | null {
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

function hasParseError(sourceFile: ts.SourceFile): boolean {
  let hasError = false;
  const visit = (node: ts.Node): void => {
    if ((node.flags & ts.NodeFlags.ThisNodeHasError) !== 0) {
      hasError = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hasError;
}

function propertyNameText(
  name: ts.PropertyName | ts.ModuleName,
  sourceFile: ts.SourceFile,
): string {
  if (
    ts.isIdentifier(name) ||
    ts.isPrivateIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return name.getText(sourceFile);
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}

function findFunctionInitializer(
  expression: ts.Expression,
): ts.ArrowFunction | ts.FunctionExpression | null {
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return expression;
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return findFunctionInitializer(expression.expression);
  }
  if (ts.isCallExpression(expression)) {
    for (const argument of expression.arguments) {
      if (ts.isSpreadElement(argument)) {
        continue;
      }
      const functionExpression = findFunctionInitializer(argument);
      if (functionExpression) {
        return functionExpression;
      }
    }
  }
  return null;
}

function signatureForNode(node: ts.Node, sourceFile: ts.SourceFile): string {
  let end = node.end;
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isConstructorDeclaration(node)) &&
    node.body
  ) {
    end = node.body.getStart(sourceFile) + 1;
  } else if (ts.isClassLike(node)) {
    end = node.members.pos;
  } else if (ts.isVariableStatement(node)) {
    const declaration = node.declarationList.declarations[0];
    const initializer = declaration?.initializer
      ? findFunctionInitializer(declaration.initializer)
      : null;
    if (initializer && ts.isBlock(initializer.body)) {
      end = initializer.body.getStart(sourceFile) + 1;
    }
  }

  return sourceFile.text
    .slice(node.getStart(sourceFile), Math.min(end, node.end))
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500);
}

function compareSymbols(
  left: ParsedSourceSymbol,
  right: ParsedSourceSymbol,
): number {
  return (
    left.startOffset - right.startOffset ||
    right.endOffset - left.endOffset ||
    left.symbolKind.localeCompare(right.symbolKind) ||
    left.symbolName.localeCompare(right.symbolName)
  );
}

export const typeScriptSourceStructureParser =
  new TypeScriptSourceStructureParser();
