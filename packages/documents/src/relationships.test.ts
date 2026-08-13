import { describe, expect, test } from "bun:test";

import {
  extractSourceRelationships,
  extractSourceRelationshipsWithDiagnostics,
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
      relationships
        .map((relationship) => ({
          type: relationship.relationshipType,
          target: relationship.targetPath,
          sourceSymbol: relationship.sourceSymbol,
          targetSymbol: relationship.targetSymbol,
        }))
        .sort((left, right) =>
          (left.sourceSymbol ?? "").localeCompare(right.sourceSymbol ?? ""),
        ),
    ).toEqual([
      {
        type: "imports",
        target: "src/side-effect.ts",
        sourceSymbol: null,
        targetSymbol: null,
      },
      {
        type: "imports",
        target: "src/input.ts",
        sourceSymbol: "defaultValue",
        targetSymbol: "value",
      },
      {
        type: "imports",
        target: "src/input.ts",
        sourceSymbol: "localValue",
        targetSymbol: "value",
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
      provenance: "typescript_compiler_relationships_v2",
      confidence: 1,
      importedName: "authenticate",
      exposedName: "authenticateRequest",
      bindingKind: "named",
      resolution: "exact_symbol",
      moduleResolutionKind: "relative",
      targetSymbolKind: "function",
      targetStartLine: 1,
      targetEndLine: 1,
    });
  });

  test("resolves the closest tsconfig path alias and preserves binding metadata", () => {
    const extraction = extractSourceRelationshipsWithDiagnostics([
      source(
        "tsconfig.json",
        '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}',
      ),
      source(
        "apps/web/tsconfig.json",
        '{"extends":"@workspace/tsconfig/nextjs.json","compilerOptions":{"baseUrl":".","paths":{"@/*":["./*"]}}}',
        new Date("2025-03-11T12:00:00.000Z"),
      ),
      source("src/value.ts", "export const value = 'root';"),
      source("apps/web/lib/value.ts", "export const value = 'web';"),
      source(
        "apps/web/main.ts",
        'import type { value as localValue } from "@/lib/value";',
      ),
    ]);

    expect(extraction.relationships).toHaveLength(1);
    expect(extraction.relationships[0]).toMatchObject({
      targetPath: "apps/web/lib/value.ts",
      importedName: "value",
      localName: "localValue",
      exposedName: null,
      bindingKind: "named",
      isTypeOnly: true,
      resolution: "exact_symbol",
      moduleResolutionKind: "path_alias",
      targetSymbol: "value",
      configurationPath: "apps/web/tsconfig.json",
      availableAt: new Date("2025-03-11T12:00:00.000Z"),
    });
    expect(extraction.diagnostics).toMatchObject({
      pathAliasBindings: 1,
      resolvedPathAliasBindings: 1,
      resolvedRelationships: 1,
      exactSymbolRelationships: 1,
      symbolBearingRelationships: 1,
      configurationFiles: 1,
    });
  });

  test("inherits local config aliases and makes every used config temporal", () => {
    const extraction = extractSourceRelationshipsWithDiagnostics([
      source(
        "configs/base.json",
        '{"compilerOptions":{"baseUrl":"..","paths":{"~/*":["shared/*"]}}}',
        new Date("2025-03-12T12:00:00.000Z"),
      ),
      source(
        "apps/service/tsconfig.json",
        '{"extends":"../../configs/base.json"}',
        new Date("2025-03-11T12:00:00.000Z"),
      ),
      source("shared/helper.ts", "export function helper() {}"),
      source("apps/service/main.ts", 'import { helper } from "~/helper";'),
    ]);

    expect(extraction.relationships[0]).toMatchObject({
      targetPath: "shared/helper.ts",
      configurationPath: "configs/base.json",
      availableAt: new Date("2025-03-12T12:00:00.000Z"),
    });
    expect(extraction.diagnostics.configurationFiles).toBe(2);
  });

  test("supports exact and wildcard aliases with longest-match precedence", () => {
    const extraction = extractSourceRelationshipsWithDiagnostics([
      source(
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: {
            paths: {
              "@exact": ["src/exact.ts"],
              "@features/*": ["src/features/*"],
              "@/*": ["fallback/*"],
            },
          },
        }),
      ),
      source("src/exact.ts", "export const exact = 1;"),
      source("src/features/nested/value.ts", "export const feature = 1;"),
      source("fallback/features/nested/value.ts", "export const wrong = 1;"),
      source(
        "main.ts",
        [
          'import { exact } from "@exact";',
          'import { feature } from "@features/nested/value";',
        ].join("\n"),
      ),
    ]);

    expect(
      extraction.relationships.map((relationship) => relationship.targetPath),
    ).toEqual(["src/exact.ts", "src/features/nested/value.ts"]);
    expect(extraction.diagnostics.pathAliasBindings).toBe(2);
  });

  test("bounds config cycles, missing parents, and repository escapes", () => {
    const cycle = extractSourceRelationshipsWithDiagnostics([
      source(
        "tsconfig.json",
        '{"extends":"./config/base.json","compilerOptions":{"paths":{"@/*":["src/*"]}}}',
      ),
      source(
        "config/base.json",
        '{"extends":"../tsconfig.json","compilerOptions":{"baseUrl":".."}}',
      ),
      source("src/value.ts", "export const value = 1;"),
      source("main.ts", 'import { value } from "@/value";'),
    ]);
    expect(cycle.relationships).toHaveLength(1);
    expect(cycle.diagnostics.configurationFailures).toBe(1);

    const unsafe = extractSourceRelationshipsWithDiagnostics([
      source(
        "apps/web/tsconfig.json",
        '{"extends":"../../../../outside.json","compilerOptions":{"paths":{"escape/*":["../../../../outside/*"]}}}',
      ),
      source("outside/value.ts", "export const value = 1;"),
      source("apps/web/main.ts", 'import { value } from "escape/value";'),
    ]);
    expect(unsafe.relationships).toEqual([]);
    expect(unsafe.diagnostics.configurationFailures).toBe(1);

    expect(
      extractSourceRelationships([
        source("../outside.ts", "export const outside = 1;"),
        source("src/main.ts", 'import { outside } from "../../outside";'),
      ]),
    ).toEqual([]);

    expect(
      extractSourceRelationships([
        source("src/value.ts", "export const value = 1;"),
        source("main.ts", 'import { value } from "@/value";'),
      ]),
    ).toEqual([]);

    const absolute = extractSourceRelationshipsWithDiagnostics([
      source(
        "apps/web/tsconfig.json",
        '{"compilerOptions":{"baseUrl":"/host","paths":{"absolute/*":["C:\\\\host\\\\*"]}}}',
      ),
      source("apps/web/host/value.ts", "export const value = 1;"),
      source("apps/web/main.ts", 'import { value } from "absolute/value";'),
    ]);
    expect(absolute.relationships).toEqual([]);
    expect(absolute.diagnostics.configurationFailures).toBe(2);
  });

  test("supports jsconfig baseUrl resolution only when an indexed target exists", () => {
    const extraction = extractSourceRelationshipsWithDiagnostics([
      source("jsconfig.json", '{"compilerOptions":{"baseUrl":"src"}}'),
      source("src/local.js", "export function local() {}"),
      source(
        "main.js",
        ['import { local } from "local";', 'import { z } from "zod";'].join(
          "\n",
        ),
      ),
    ]);

    expect(extraction.relationships).toHaveLength(1);
    expect(extraction.relationships[0]).toMatchObject({
      targetPath: "src/local.js",
      moduleResolutionKind: "base_url",
      resolution: "exact_symbol",
    });
    expect(extraction.diagnostics.baseUrlBindings).toBe(1);
    expect(extraction.diagnostics.externalBindings).toBe(1);
  });

  test("does not create edges for ambiguous aliases or malformed configs", () => {
    const ambiguous = extractSourceRelationshipsWithDiagnostics([
      source(
        "tsconfig.json",
        '{"compilerOptions":{"paths":{"@/*":["src/*","generated/*"]}}}',
      ),
      source("src/value.ts", "export const value = 1;"),
      source("generated/value.ts", "export const value = 2;"),
      source("main.ts", 'import { value } from "@/value";'),
    ]);
    expect(ambiguous.relationships).toEqual([]);
    expect(ambiguous.diagnostics.ambiguousLocalBindings).toBe(1);

    const malformed = extractSourceRelationshipsWithDiagnostics([
      source("tsconfig.json", "{"),
      source("src/value.ts", "export const value = 1;"),
      source("main.ts", 'import { value } from "@/value";'),
    ]);
    expect(malformed.relationships).toEqual([]);
    expect(malformed.diagnostics.configurationFailures).toBe(1);
  });

  test("falls back to exact-module when an export cannot be proven uniquely", () => {
    const extraction = extractSourceRelationshipsWithDiagnostics([
      source(
        "src/target.ts",
        "const hidden = 1; export { hidden as publicValue };",
      ),
      source(
        "src/main.ts",
        [
          'import * as target from "./target";',
          'import { missing } from "./target";',
          'import "./target";',
          'export * from "./target";',
        ].join("\n"),
      ),
    ]);

    expect(extraction.relationships).toHaveLength(4);
    expect(
      extraction.relationships.every(
        (relationship) =>
          relationship.resolution === "exact_module" &&
          relationship.targetSymbol === null,
      ),
    ).toBe(true);
    expect(extraction.diagnostics.exactModuleRelationships).toBe(4);
  });

  test("targets exported functions, classes, interfaces, variables, and defaults", () => {
    const relationships = extractSourceRelationships([
      source(
        "src/definitions.ts",
        [
          "export function run() {}",
          "export class Service {}",
          "export interface Session { id: string }",
          "export const setting = true;",
          "export default class Provider {}",
        ].join("\n"),
      ),
      source(
        "src/main.ts",
        [
          'import Provider, { run, Service, type Session, setting } from "./definitions";',
        ].join("\n"),
      ),
    ]);

    expect(
      relationships
        .map((relationship) => ({
          importedName: relationship.importedName,
          targetSymbol: relationship.targetSymbol,
          targetSymbolKind: relationship.targetSymbolKind,
          isTypeOnly: relationship.isTypeOnly,
          resolution: relationship.resolution,
        }))
        .sort((left, right) =>
          (left.importedName ?? "").localeCompare(right.importedName ?? ""),
        ),
    ).toEqual([
      {
        importedName: "default",
        targetSymbol: "Provider",
        targetSymbolKind: "class",
        isTypeOnly: false,
        resolution: "exact_symbol",
      },
      {
        importedName: "run",
        targetSymbol: "run",
        targetSymbolKind: "function",
        isTypeOnly: false,
        resolution: "exact_symbol",
      },
      {
        importedName: "Service",
        targetSymbol: "Service",
        targetSymbolKind: "class",
        isTypeOnly: false,
        resolution: "exact_symbol",
      },
      {
        importedName: "Session",
        targetSymbol: "Session",
        targetSymbolKind: "interface",
        isTypeOnly: true,
        resolution: "exact_symbol",
      },
      {
        importedName: "setting",
        targetSymbol: "setting",
        targetSymbolKind: "variable",
        isTypeOnly: false,
        resolution: "exact_symbol",
      },
    ]);
  });

  test("targets default re-exports and keeps anonymous expressions module-only", () => {
    const relationships = extractSourceRelationships([
      source("src/provider.ts", "export default class Provider {}"),
      source("src/anonymous.ts", "export default (() => true);"),
      source(
        "src/index.ts",
        [
          'export { default as Provider } from "./provider";',
          'export { default as anonymous } from "./anonymous";',
          'export { missing } from "./missing";',
        ].join("\n"),
      ),
    ]);

    expect(relationships).toHaveLength(2);
    expect(
      relationships.map((relationship) => ({
        exposedName: relationship.exposedName,
        importedName: relationship.importedName,
        targetSymbol: relationship.targetSymbol,
        resolution: relationship.resolution,
      })),
    ).toEqual([
      {
        exposedName: "anonymous",
        importedName: "default",
        targetSymbol: null,
        resolution: "exact_module",
      },
      {
        exposedName: "Provider",
        importedName: "default",
        targetSymbol: "Provider",
        resolution: "exact_symbol",
      },
    ]);
  });

  test("does not claim duplicate exported declarations are exact", () => {
    const relationships = extractSourceRelationships([
      source(
        "src/overloaded.ts",
        [
          "export function parse(value: string): string;",
          "export function parse(value: number): number;",
          "export function parse(value: string | number) { return value; }",
        ].join("\n"),
      ),
      source("src/main.ts", 'import { parse } from "./overloaded";'),
    ]);
    expect(relationships[0]).toMatchObject({
      resolution: "exact_module",
      targetSymbol: null,
      targetSymbolKind: null,
    });
  });

  test("keeps identical paths isolated by repository", () => {
    const otherRepositoryId = "223e4567-e89b-42d3-a456-426614174000";
    const relationships = extractSourceRelationships([
      source("src/target.ts", "export const first = 1;"),
      source("src/main.ts", 'import { first } from "./target";'),
      source(
        "src/target.ts",
        "export const second = 2;",
        committedAt,
        otherRepositoryId,
      ),
      source(
        "src/main.ts",
        'import { second } from "./target";',
        committedAt,
        otherRepositoryId,
      ),
    ]);

    expect(relationships).toHaveLength(2);
    expect(
      relationships.map((relationship) => ({
        repositoryId: relationship.repositoryId,
        targetSymbol: relationship.targetSymbol,
      })),
    ).toEqual([
      { repositoryId, targetSymbol: "first" },
      { repositoryId: otherRepositoryId, targetSymbol: "second" },
    ]);
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

function source(
  path: string,
  content: string,
  timestamp = committedAt,
  sourceRepositoryId = repositoryId,
): RelationshipSourceFile {
  const sourceEntityId = crypto.randomUUID();
  return {
    content,
    document: normalizeSourceCodeDocument({
      repositoryId: sourceRepositoryId,
      sourceEntityId,
      path,
      commitSha: "a".repeat(40),
      committedAt: timestamp,
      content,
      sourceReference: `git:${"a".repeat(40)}:${path}`,
    }),
  };
}
