import { describe, expect, test } from "bun:test";

import { classifySourceRoleMetadata } from "./source-role";

describe("classifySourceRoleMetadata", () => {
  test.each([
    ["src/auth/session.ts", "production_implementation"],
    ["src/auth/session.test.ts", "unit_test"],
    ["src/auth/session.integration.test.ts", "integration_test"],
    ["playwright/auth/session.spec.ts", "e2e_test"],
    ["docs/authentication.mdx", "documentation"],
    [
      "docs/api-reference/authentication.mdx",
      "generated_reference_documentation",
    ],
    ["src/env.ts", "configuration"],
    ["database/schema.prisma", "database_schema"],
    ["database/migrations/20250101_add_session/migration.sql", "migration"],
    ["scripts/rebuild-index.sh", "script"],
    ["src/__fixtures__/session.json", "fixture"],
    ["src/generated/client.ts", "generated"],
    ["openapi/paths/session.yml", "api_definition"],
  ] as const)("classifies %s as %s", (path, role) => {
    expect(
      classifySourceRoleMetadata({ sourceType: "source_code", path }),
    ).toMatchObject({ role, evidence: [expect.any(String)] });
  });

  test("uses structural metadata for type definitions", () => {
    expect(
      classifySourceRoleMetadata({
        sourceType: "source_code",
        path: "src/auth.ts",
        symbolKind: "interface",
      }),
    ).toMatchObject({ role: "type_definition" });
  });

  test("classifies development records independently from provider details", () => {
    expect(
      classifySourceRoleMetadata({ sourceType: "pull_request", path: null }),
    ).toEqual({
      role: "development_history",
      confidence: 1,
      evidence: ["source-type:pull_request"],
    });
  });

  test.each([
    ["data/catalog.json", null],
    ["assets/payload.yaml", "YAML"],
    ["schema.json", null],
  ] as const)(
    "conservatively leaves %s unknown even with language metadata",
    (path, language) => {
      expect(
        classifySourceRoleMetadata({
          sourceType: "source_code",
          path,
          language,
        }),
      ).toMatchObject({ role: "unknown" });
    },
  );

  test("handles malformed source metadata without throwing", () => {
    expect(
      classifySourceRoleMetadata({ sourceType: "source_code", path: null }),
    ).toMatchObject({ role: "unknown" });
  });
});
