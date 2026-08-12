import { describe, expect, test } from "bun:test";

import {
  normalizeSourceCodeDocument,
  type SourceStructureParser,
} from "./index";

const repositoryId = "123e4567-e89b-42d3-a456-426614174000";
const sourceEntityId = "323e4567-e89b-42d3-a456-426614174000";

describe("structural source-code chunking", () => {
  test("extracts exported TypeScript functions, arrows, interfaces, types, and enums", () => {
    const generated = sourceDocument(
      "src/contracts.ts",
      [
        'import type { Input } from "./input";',
        "export interface Session { id: string }",
        'export type SessionId = string & { readonly brand: "session" };',
        "export enum SessionState { Active, Expired }",
        "export function getSession(input: Input): Session | null { return null; }",
        "export const getProxySession = async (input: Input) => ({ id: String(input) });",
      ].join("\n\n"),
    );

    expect(generated.document.chunkingStrategy).toBe(
      "source_code_structural_v1",
    );
    expect(
      generated.chunks.map((chunk) => [chunk.symbolKind, chunk.symbolName]),
    ).toEqual([
      ["module", null],
      ["interface", "Session"],
      ["type", "SessionId"],
      ["enum", "SessionState"],
      ["function", "getSession"],
      ["function", "getProxySession"],
    ]);
    expect(generated.chunks.at(-1)).toMatchObject({
      language: "TypeScript",
      startLine: 11,
      endLine: 11,
      symbolPart: 1,
      symbolPartCount: 1,
    });
    expect(generated.chunks.at(-1)?.content).toContain(
      "export const getProxySession",
    );
  });

  test("extracts classes, methods, properties, and nested functions with parents", () => {
    const generated = sourceDocument(
      "src/session.ts",
      [
        "export class SessionService {",
        '  private token = "";',
        "  getProxySession() {",
        "    const readToken = () => this.token;",
        "    return readToken();",
        "  }",
        "}",
      ].join("\n"),
    );

    expect(symbol(generated, "SessionService")).toMatchObject({
      symbolKind: "class",
      parentSymbol: null,
    });
    expect(symbol(generated, "token")).toMatchObject({
      symbolKind: "property",
      parentSymbol: "SessionService",
    });
    expect(symbol(generated, "getProxySession")).toMatchObject({
      symbolKind: "method",
      parentSymbol: "SessionService",
      startLine: 3,
      endLine: 6,
    });
    expect(symbol(generated, "readToken")).toMatchObject({
      symbolKind: "function",
      parentSymbol: "getProxySession",
      startLine: 4,
      endLine: 4,
    });
  });

  test("extracts TSX and JSX function components", () => {
    for (const [path, declaration, language] of [
      [
        "src/ending-card.tsx",
        "export function EndingCard() { return <section>Done</section>; }",
        "TSX",
      ],
      [
        "src/ending-card.jsx",
        "export const EndingCard = () => <section>Done</section>;",
        "JSX",
      ],
    ] as const) {
      const generated = sourceDocument(path, declaration);
      expect(symbol(generated, "EndingCard")).toMatchObject({
        language,
        symbolKind: "function",
      });
    }
  });

  test("supports JavaScript with the same parser adapter", () => {
    const generated = sourceDocument(
      "src/session.js",
      "export function getSession() { return null; }",
    );

    expect(symbol(generated, "getSession")).toMatchObject({
      language: "JavaScript",
      symbolKind: "function",
    });
  });

  test("subdivides a large symbol and links every bounded part", () => {
    const body = Array.from(
      { length: 260 },
      (_, index) => `  const value${index} = ${index};`,
    ).join("\n");
    const generated = sourceDocument(
      "src/large.ts",
      `export function buildLargeConfiguration() {\n${body}\n  return value259;\n}`,
    );
    const parts = generated.chunks.filter(
      (chunk) => chunk.symbolName === "buildLargeConfiguration",
    );

    expect(parts.length).toBeGreaterThan(2);
    expect(new Set(parts.map((chunk) => chunk.symbolId)).size).toBe(1);
    expect(parts.map((chunk) => chunk.symbolPart)).toEqual(
      Array.from({ length: parts.length }, (_, index) => index + 1),
    );
    expect(
      parts.every(
        (chunk) =>
          chunk.symbolPartCount === parts.length &&
          chunk.content.length <= 12_000,
      ),
    ).toBe(true);
    expect(parts[1]?.content).toContain(
      "SWEGA structural context: function buildLargeConfiguration",
    );
  });

  test("keeps structural context inside the bound for a giant source line", () => {
    const generated = sourceDocument(
      "src/large-line.ts",
      `export function largeLine() { return "${"x".repeat(13_000)}"; }`,
    );
    const parts = generated.chunks.filter(
      (chunk) => chunk.symbolName === "largeLine",
    );

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((chunk) => chunk.content.length <= 12_000)).toBe(true);
  });

  test("falls back safely for malformed source and parser failures", () => {
    const malformed = sourceDocument(
      "src/broken.ts",
      "export function broken( {",
    );
    expect(malformed.document.chunkingStrategy).toBe("source_code_v1");
    expect(malformed.chunks[0]).toMatchObject({
      language: "TypeScript",
      symbolId: null,
      symbolName: null,
      symbolKind: null,
    });

    const failingParser: SourceStructureParser = {
      id: "failing-fixture",
      parse: () => {
        throw new Error("fixture parser failure");
      },
    };
    const failed = normalizeSourceCodeDocument(
      sourceInput("src/valid.ts", "export const valid = true;"),
      { structureParser: failingParser },
    );
    expect(failed.document.chunkingStrategy).toBe("source_code_v1");
    expect(failed.chunks[0]?.content).toBe("export const valid = true;");
  });

  test("keeps structural document and chunk identities deterministic", () => {
    const input = sourceInput(
      "src/session.ts",
      "export const getSession = async () => null;",
    );
    const first = normalizeSourceCodeDocument(input);
    const second = normalizeSourceCodeDocument(input);

    expect(second).toEqual(first);
    expect(new Set(first.chunks.map((chunk) => chunk.id)).size).toBe(
      first.chunks.length,
    );
  });
});

function sourceDocument(path: string, content: string) {
  return normalizeSourceCodeDocument(sourceInput(path, content));
}

function sourceInput(path: string, content: string) {
  return {
    repositoryId,
    sourceEntityId,
    path,
    commitSha: "a".repeat(40),
    committedAt: new Date("2025-03-10T12:00:00.000Z"),
    content,
    sourceReference: `git:${"a".repeat(40)}:${path}`,
  };
}

function symbol(
  generated: ReturnType<typeof normalizeSourceCodeDocument>,
  name: string,
) {
  const chunk = generated.chunks.find(
    (candidate) => candidate.symbolName === name,
  );
  if (!chunk) {
    throw new Error(`Expected structural chunk for '${name}'`);
  }
  return chunk;
}
