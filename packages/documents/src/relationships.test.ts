import { describe, expect, test } from "bun:test";

import {
  extractSourceRelationships,
  normalizeSourceCodeDocument,
  type RelationshipSourceFile,
} from "./index";

const repositoryId = "123e4567-e89b-42d3-a456-426614174000";
const committedAt = new Date("2025-03-10T12:00:00.000Z");

describe("source relationships", () => {
  test("resolves named, aliased, default, side-effect, and multiple imports", () => {
    const relationships = extractSourceRelationships([
      source("src/input.ts", "export const value = 1; export default value;"),
      source("src/side-effect.ts", "globalThis.ready = true;"),
      source(
        "src/main.ts",
        [
          'import defaultValue, { value as localValue } from "./input";',
          'import "./side-effect";',
        ].join("\n"),
      ),
    ]);

    expect(
      relationships.map((relationship) => ({
        type: relationship.relationshipType,
        target: relationship.targetPath,
        sourceSymbol: relationship.sourceSymbol,
        targetSymbol: relationship.targetSymbol,
      })),
    ).toEqual([
      {
        type: "imports",
        target: "src/input.ts",
        sourceSymbol: "defaultValue",
        targetSymbol: "default",
      },
      {
        type: "imports",
        target: "src/input.ts",
        sourceSymbol: "localValue",
        targetSymbol: "value",
      },
      {
        type: "imports",
        target: "src/side-effect.ts",
        sourceSymbol: null,
        targetSymbol: null,
      },
    ]);
  });

  test("extracts re-exports with symbol provenance", () => {
    const relationships = extractSourceRelationships([
      source(
        "src/implementation.ts",
        "export const authenticate = () => true;",
      ),
      source(
        "src/index.ts",
        'export { authenticate as authenticateRequest } from "./implementation";',
      ),
    ]);

    expect(relationships[0]).toMatchObject({
      relationshipType: "reexports",
      sourcePath: "src/index.ts",
      targetPath: "src/implementation.ts",
      sourceSymbol: "authenticateRequest",
      targetSymbol: "authenticate",
      sourceStartLine: 1,
      provenance: "typescript_compiler_relationships_v1",
      confidence: 1,
    });
  });

  test("ignores unresolved and external imports safely", () => {
    const relationships = extractSourceRelationships([
      source(
        "src/main.ts",
        [
          'import { z } from "zod";',
          'import { missing } from "./missing";',
        ].join("\n"),
      ),
    ]);
    expect(relationships).toEqual([]);
  });

  test("supports circular imports without traversal and remains deterministic", () => {
    const files = [
      source("src/a.ts", 'import { b } from "./b"; export const a = b;'),
      source("src/b.ts", 'import { a } from "./a"; export const b = a;'),
    ];
    const first = extractSourceRelationships(files);
    const second = extractSourceRelationships(files);

    expect(second).toEqual(first);
    expect(first).toHaveLength(2);
    expect(new Set(first.map((relationship) => relationship.id)).size).toBe(2);
  });

  test("leaves unsupported languages functional without fabricated relationships", () => {
    expect(
      extractSourceRelationships([
        source("src/main.py", "from .helper import work"),
        source("src/helper.py", "def work(): pass"),
      ]),
    ).toEqual([]);
  });
});

function source(path: string, content: string): RelationshipSourceFile {
  const sourceEntityId = crypto.randomUUID();
  return {
    content,
    document: normalizeSourceCodeDocument({
      repositoryId,
      sourceEntityId,
      path,
      commitSha: "a".repeat(40),
      committedAt,
      content,
      sourceReference: `git:${"a".repeat(40)}:${path}`,
    }),
  };
}
