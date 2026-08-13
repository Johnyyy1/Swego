import { basename, extname } from "node:path";

import type { MemorySourceType, SourceSymbolKind } from "@swega/shared";

import type { MemorySearchResult } from "./types";

export const sourceRoles = [
  "production_implementation",
  "unit_test",
  "integration_test",
  "e2e_test",
  "configuration",
  "documentation",
  "generated_reference_documentation",
  "database_schema",
  "migration",
  "api_definition",
  "script",
  "type_definition",
  "fixture",
  "generated",
  "development_history",
  "unknown",
] as const;

export type SourceRole = (typeof sourceRoles)[number];

export interface SourceRoleClassification {
  role: SourceRole;
  confidence: number;
  evidence: readonly string[];
}

export interface SourceRoleInput {
  sourceType: MemorySourceType;
  path: string | null;
  language?: string | null;
  symbolKind?: SourceSymbolKind | null;
}

const productionExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".cxx",
  ".dart",
  ".ex",
  ".exs",
  ".fs",
  ".fsx",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".lua",
  ".m",
  ".php",
  ".pl",
  ".py",
  ".rb",
  ".rs",
  ".scala",
  ".swift",
  ".svelte",
  ".ts",
  ".tsx",
  ".vue",
  ".zig",
]);
const documentationExtensions = new Set([
  ".adoc",
  ".md",
  ".mdx",
  ".rst",
  ".txt",
]);
const configurationNames = new Set([
  ".babelrc",
  ".editorconfig",
  ".env",
  ".env.example",
  ".eslintrc",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  ".prettierignore",
  ".prettierrc",
  "cargo.toml",
  "compose.yaml",
  "compose.yml",
  "deno.json",
  "docker-compose.yaml",
  "docker-compose.yml",
  "dockerfile",
  "gemfile",
  "go.mod",
  "package.json",
  "pnpm-workspace.yaml",
  "pyproject.toml",
  "turbo.json",
]);

export function classifySourceRole(
  result: Pick<MemorySearchResult, "sourceType" | "path" | "sourceMetadata">,
): SourceRoleClassification {
  return classifySourceRoleMetadata({
    sourceType: result.sourceType,
    path: result.path,
    language: result.sourceMetadata.language,
    symbolKind: result.sourceMetadata.symbolKind,
  });
}

export function classifySourceRoleMetadata(
  input: SourceRoleInput,
): SourceRoleClassification {
  if (input.sourceType !== "source_code") {
    return classification(
      "development_history",
      1,
      `source-type:${input.sourceType}`,
    );
  }
  if (!input.path) {
    return classification("unknown", 1, "source-code path unavailable");
  }

  const path = normalizePath(input.path);
  const lowerPath = path.toLowerCase();
  const segments = lowerPath.split("/");
  const filename = basename(lowerPath);
  const extension = extname(filename);

  if (isFixture(segments, filename)) {
    return classification("fixture", 0.95, "path-pattern:fixture");
  }
  if (isE2eTest(segments, filename)) {
    return classification("e2e_test", 1, "path-pattern:e2e-test");
  }
  if (isIntegrationTest(segments, filename)) {
    return classification(
      "integration_test",
      1,
      "path-pattern:integration-test",
    );
  }
  if (isUnitTest(segments, filename)) {
    return classification("unit_test", 1, "path-pattern:unit-test");
  }
  if (isMigration(segments, filename, extension)) {
    return classification("migration", 1, "path-pattern:migration");
  }
  if (isDatabaseSchema(segments, filename, extension)) {
    return classification("database_schema", 1, "path-pattern:database-schema");
  }
  if (isApiDefinition(segments, filename, extension)) {
    return classification(
      "api_definition",
      0.95,
      "path-pattern:api-definition",
    );
  }
  if (isGeneratedReferenceDocumentation(segments, extension)) {
    return classification(
      "generated_reference_documentation",
      0.9,
      "path-pattern:generated-reference-documentation",
    );
  }
  if (isGenerated(segments, filename)) {
    return classification("generated", 0.9, "path-pattern:generated");
  }
  if (isDocumentation(segments, filename, extension)) {
    return classification("documentation", 1, "path-pattern:documentation");
  }
  if (isConfiguration(segments, filename, extension)) {
    return classification("configuration", 0.95, "path-pattern:configuration");
  }
  if (isScript(segments, extension)) {
    return classification("script", 0.9, "path-pattern:script");
  }
  if (
    filename.endsWith(".d.ts") ||
    input.symbolKind === "interface" ||
    input.symbolKind === "type" ||
    input.symbolKind === "enum"
  ) {
    return classification(
      "type_definition",
      0.9,
      filename.endsWith(".d.ts")
        ? "filename-pattern:type-definition"
        : `symbol-kind:${input.symbolKind}`,
    );
  }
  if (
    productionExtensions.has(extension) ||
    (input.symbolKind !== null && input.symbolKind !== undefined)
  ) {
    return classification(
      "production_implementation",
      0.8,
      productionExtensions.has(extension)
        ? `authored-source-extension:${extension}`
        : "structural source metadata",
    );
  }
  return classification("unknown", 1, "no stable source-role signal");
}

function isFixture(segments: readonly string[], filename: string): boolean {
  return (
    segments.some((segment) =>
      /^(?:__fixtures__|fixture|fixtures|testdata)$/u.test(segment),
    ) || /(?:^|[._-])fixture(?:[._-]|$)/u.test(filename)
  );
}

function isE2eTest(segments: readonly string[], filename: string): boolean {
  return (
    segments.some((segment) =>
      /^(?:e2e|end-to-end|playwright|cypress)$/u.test(segment),
    ) || /(?:^|[._-])e2e(?:[._-]|$)/u.test(filename)
  );
}

function isIntegrationTest(
  segments: readonly string[],
  filename: string,
): boolean {
  return (
    segments.some((segment) =>
      /^(?:integration|integration-tests?)$/u.test(segment),
    ) || /(?:^|[._-])integration(?:[._-]|$)/u.test(filename)
  );
}

function isUnitTest(segments: readonly string[], filename: string): boolean {
  return (
    segments.some((segment) =>
      /^(?:__tests__|test|tests|unit|unit-tests?)$/u.test(segment),
    ) ||
    /\.(?:spec|test)\.[^.]+$/u.test(filename) ||
    /^(?:test|spec)_[^.]+/u.test(filename) ||
    /_[Tt]est\.[^.]+$/u.test(filename)
  );
}

function isMigration(
  segments: readonly string[],
  filename: string,
  extension: string,
): boolean {
  return (
    segments.some((segment) => /^(?:migration|migrations)$/u.test(segment)) ||
    /(?:^|[._-])migration(?:[._-]|$)/u.test(filename) ||
    (extension === ".sql" &&
      segments.some((segment) => /^(?:migrate|migrations?)$/u.test(segment)))
  );
}

function isDatabaseSchema(
  segments: readonly string[],
  filename: string,
  extension: string,
): boolean {
  if (filename === "schema.prisma" || extension === ".prisma") return true;
  const databaseContext = segments.some((segment) =>
    /^(?:database|db|drizzle|models?|prisma)$/u.test(segment),
  );
  return (
    databaseContext && /(?:^|[._-])(?:schema|model)(?:[._-]|$)/u.test(filename)
  );
}

function isApiDefinition(
  segments: readonly string[],
  filename: string,
  extension: string,
): boolean {
  return (
    /^(?:openapi|swagger)(?:\.[^.]+)?\.(?:json|ya?ml)$/u.test(filename) ||
    segments.some((segment) => /^(?:openapi|swagger)$/u.test(segment)) ||
    ((extension === ".json" || extension === ".yaml" || extension === ".yml") &&
      segments.some((segment) =>
        /^(?:api-reference|api_reference)$/u.test(segment),
      ))
  );
}

function isGeneratedReferenceDocumentation(
  segments: readonly string[],
  extension: string,
): boolean {
  return (
    documentationExtensions.has(extension) &&
    segments.some((segment) =>
      /^(?:api-reference|api_reference|generated-reference|generated_reference)$/u.test(
        segment,
      ),
    )
  );
}

function isGenerated(segments: readonly string[], filename: string): boolean {
  return (
    segments.some((segment) => /^(?:generated|gen)$/u.test(segment)) ||
    /(?:^|[._-])generated(?:[._-]|$)/u.test(filename)
  );
}

function isDocumentation(
  segments: readonly string[],
  filename: string,
  extension: string,
): boolean {
  return (
    documentationExtensions.has(extension) ||
    /^readme(?:\.|$)/u.test(filename) ||
    segments.some((segment) => /^(?:doc|docs|documentation)$/u.test(segment))
  );
}

function isConfiguration(
  segments: readonly string[],
  filename: string,
  extension: string,
): boolean {
  return (
    configurationNames.has(filename) ||
    /(?:^|[._-])config(?:uration)?(?:[._-]|$)/u.test(filename) ||
    /^tsconfig(?:\.[^.]+)?\.json$/u.test(filename) ||
    /^env\.(?:[cm]?[jt]s|py|rb)$/u.test(filename) ||
    filename === ".env.example" ||
    segments.join("/").startsWith(".github/workflows/") ||
    (segments.some((segment) =>
      /^(?:deploy|deployment|k8s|kubernetes)$/u.test(segment),
    ) &&
      [".json", ".toml", ".yaml", ".yml"].includes(extension)) ||
    extension === ".tf"
  );
}

function isScript(segments: readonly string[], extension: string): boolean {
  return (
    segments.some((segment) => /^(?:bin|script|scripts)$/u.test(segment)) ||
    [".bash", ".bat", ".cmd", ".ps1", ".sh", ".zsh"].includes(extension)
  );
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function classification(
  role: SourceRole,
  confidence: number,
  evidence: string,
): SourceRoleClassification {
  return { role, confidence, evidence: [evidence] };
}
