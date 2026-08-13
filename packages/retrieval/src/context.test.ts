import { describe, expect, test } from "bun:test";

import { EvidencePackBuilder, selectEvidenceAnchors } from "./context";
import { formatEvidencePack, formatEvidencePackJson } from "./context-format";
import type {
  ContextEvidenceSource,
  LocalContextCandidate,
} from "./context-types";
import { analyzeQueryIntent } from "./query-intent";
import type { RelationshipExpansion } from "./relationship-expansion";
import type { MemorySearchResult, RepositoryMemory } from "./types";

const repositoryId = "123e4567-e89b-42d3-a456-426614174000";
const cutoff = new Date("2025-03-15T00:00:00.000Z");

describe("Evidence Pack anchors", () => {
  test("selects top-ranked anchors across distinct paths", () => {
    const results = [
      result("one", { path: "src/one.ts" }),
      result("two", { path: "src/two.ts" }),
      result("three", { path: "src/three.ts" }),
      result("four", { path: "src/four.ts" }),
    ];
    expect(
      selectEvidenceAnchors(
        results,
        analyzeQueryIntent("how is this implemented"),
        3,
      ).map(id),
    ).toEqual(["one", "two", "three"]);
  });

  test("does not let near-duplicate chunks from one file consume anchors", () => {
    const results = [
      result("one-a", { path: "src/one.ts", symbolName: "one" }),
      result("one-b", { path: "src/one.ts", symbolName: "other" }),
      result("two", { path: "src/two.ts" }),
    ];
    expect(
      selectEvidenceAnchors(
        results,
        analyzeQueryIntent("general query"),
        2,
      ).map(id),
    ).toEqual(["one-a", "two"]);
  });

  test("promotes an exact-symbol match for exact-symbol intent", () => {
    const results = [
      result("semantic", { path: "src/semantic.ts" }),
      result("exact", {
        path: "src/exact.ts",
        structuredExactMatch: true,
      }),
    ];
    expect(
      selectEvidenceAnchors(results, analyzeQueryIntent("getSession"), 1).map(
        id,
      ),
    ).toEqual(["exact"]);
  });

  test("keeps deterministic input order for equal evidence", () => {
    const results = [result("b", {}), result("a", {})];
    const first = selectEvidenceAnchors(
      results,
      analyzeQueryIntent("general query"),
      2,
    ).map(id);
    const second = selectEvidenceAnchors(
      results,
      analyzeQueryIntent("general query"),
      2,
    ).map(id);
    expect(first).toEqual(["b", "a"]);
    expect(second).toEqual(first);
  });

  test("uses intent-compatible source roles without filtering final results", () => {
    const testResult = result("test", { path: "src/service.test.ts" });
    const implementation = result("implementation", {
      path: "src/service.ts",
    });
    expect(
      selectEvidenceAnchors(
        [testResult, implementation],
        analyzeQueryIntent("how is the service implementation structured"),
        1,
      ).map(id),
    ).toEqual(["implementation"]);
    expect(
      selectEvidenceAnchors(
        [implementation, testResult],
        analyzeQueryIntent("where are service tests"),
        1,
      ).map(id),
    ).toEqual(["test"]);
  });

  test("prefers implementation for endpoint intent and migrations for migration intent", () => {
    const docs = result("docs", {
      path: "docs/api/reference.yml",
      symbolName: null,
      symbolKind: null,
    });
    const route = result("route", { path: "app/api/route.ts" });
    expect(
      selectEvidenceAnchors(
        [docs, route],
        analyzeQueryIntent("where is the API endpoint implemented"),
        1,
      ).map(id),
    ).toEqual(["route"]);

    const schema = result("schema", {
      path: "database/schema.prisma",
      symbolName: null,
      symbolKind: null,
    });
    const migration = result("migration", {
      path: "database/migrations/001_add_session/migration.sql",
      symbolName: null,
      symbolKind: null,
    });
    expect(
      selectEvidenceAnchors(
        [schema, migration],
        analyzeQueryIntent("which migration added Session"),
        1,
      ).map(id),
    ).toEqual(["migration"]);
  });
});

describe("Evidence Pack expansion", () => {
  test("adds parent, same-symbol, structural-neighbor, and fallback context", async () => {
    const anchor = result("anchor", {
      path: "src/service.ts",
      symbolName: "run",
      symbolKind: "method",
    });
    const local: LocalContextCandidate[] = [
      localCandidate(anchor, result("same", {}), "same_symbol_context"),
      localCandidate(anchor, result("parent", {}), "parent_symbol"),
      localCandidate(
        anchor,
        result("neighbor", { symbolName: "nearby" }),
        "structural_neighbor",
      ),
      localCandidate(
        anchor,
        result("fallback", { symbolName: null, symbolKind: null }),
        "fallback_line_context",
      ),
    ];
    const pack = await builder([anchor], { local }).build(baseInput());
    expect(pack.evidence.map((item) => item.reasons[0]?.kind)).toEqual([
      "retrieved_primary",
      "same_symbol_context",
      "parent_symbol",
      "structural_neighbor",
      "fallback_line_context",
    ]);
  });

  test("adds import targets and imported-by callers with relationship provenance", async () => {
    const anchor = result("anchor", { path: "src/anchor.ts" });
    const dependency = relationshipResult("dependency", "imports", {
      path: "src/dependency.ts",
      relationshipTargetSymbol: "dependency",
      relationshipResolution: "exact_symbol",
      relationshipModuleResolutionKind: "path_alias",
      relationshipImportedName: "dependency",
      relationshipLocalName: "localDependency",
      relationshipBindingKind: "named",
      relationshipConfigurationPath: "tsconfig.json",
      relationshipConfigurationCommitSha: "a".repeat(40),
    });
    const caller = relationshipResult("caller", "imported_by", {
      path: "src/caller.ts",
    });
    const pack = await builder([anchor], {
      related: [dependency, caller],
    }).build(baseInput({ query: "how is the anchor implemented" }));
    expect(pack.evidence.map((item) => item.contextRole)).toContain(
      "DEPENDENCY",
    );
    expect(pack.evidence.map((item) => item.contextRole)).toContain("CALLER");
    expect(
      pack.evidence.flatMap((item) =>
        item.relationships.map((edge) => edge.type),
      ),
    ).toEqual(["imports", "imported_by"]);
    expect(
      pack.evidence.flatMap((item) => item.relationships)[0],
    ).toMatchObject({
      resolution: "exact_symbol",
      moduleResolutionKind: "path_alias",
      importedName: "dependency",
      localName: "localDependency",
      configurationPath: "tsconfig.json",
    });
    expect(
      pack.evidence.flatMap((item) =>
        item.reasons.map((reason) => reason.kind),
      ),
    ).toContain("imports_symbol");
  });

  test("labels module-only imports without claiming an exact symbol", async () => {
    const anchor = result("anchor", { path: "src/anchor.ts" });
    const dependency = relationshipResult("dependency", "imports", {
      path: "src/dependency.ts",
      relationshipTargetSymbol: null,
      relationshipResolution: "exact_module",
      relationshipModuleResolutionKind: "relative",
      relationshipBindingKind: "namespace",
    });
    const pack = await builder([anchor], { related: [dependency] }).build(
      baseInput(),
    );
    expect(pack.evidence[1]?.reasons[0]?.kind).toBe("imports_module");
    expect(pack.evidence[1]?.relationships[0]).toMatchObject({
      resolution: "exact_module",
      targetSymbol: null,
    });
  });

  test("classifies a related type, configuration, schema, and representative test", async () => {
    const anchor = result("anchor", {});
    const related = [
      relationshipResult("type", "imports", {
        path: "src/types.ts",
        symbolKind: "interface",
      }),
      relationshipResult("config", "imports", { path: "config.ts" }),
      relationshipResult("schema", "imports", {
        path: "database/schema.prisma",
      }),
      relationshipResult("test", "imported_by", {
        path: "src/anchor.test.ts",
      }),
    ];
    const pack = await builder([anchor], { related }).build(
      baseInput({ query: "configuration database tests for implementation" }),
    );
    expect(new Set(pack.evidence.map((item) => item.contextRole))).toEqual(
      new Set([
        "PRIMARY",
        "TYPE_OR_INTERFACE",
        "CONFIGURATION",
        "SCHEMA",
        "TEST",
      ]),
    );
  });

  test("safely ignores unresolved relationships", async () => {
    const pack = await builder([result("anchor", {})]).build(baseInput());
    expect(pack.evidence).toHaveLength(1);
  });

  test("keeps source role and context role distinct for a primary test", async () => {
    const pack = await builder([
      result("integration", {
        path: "src/service.integration.test.ts",
      }),
    ]).build(baseInput({ query: "where is the integration test" }));
    expect(pack.evidence[0]).toMatchObject({
      contextRole: "TEST",
      source: { sourceRole: "integration_test" },
      reasons: [{ kind: "retrieved_primary" }],
    });
  });

  test("does not expand current source for history intent", async () => {
    const anchor = result("history", {
      sourceType: "commit",
      path: null,
    });
    let localCalls = 0;
    let relationshipCalls = 0;
    const pack = await builder([anchor], {
      local: [
        localCandidate(anchor, result("future-current", {}), "parent_symbol"),
      ],
      onLocal: () => localCalls++,
      onRelationships: () => relationshipCalls++,
    }).build(baseInput({ query: "why was authentication changed in history" }));
    expect(pack.evidence).toHaveLength(1);
    expect(pack.evidence[0]?.source.sourceType).toBe("commit");
    expect(localCalls).toBe(0);
    expect(relationshipCalls).toBe(0);
  });
});

describe("Evidence Pack intent and budgeting", () => {
  test.each([
    ["how is this implemented", "implementation"],
    ["where are the tests", "tests"],
    ["where is this configured", "configuration"],
    ["which database schema stores this", "database_schema"],
    ["getSession", "exact_symbol"],
    ["survey behavior", "general"],
  ] as const)("preserves %s intent", async (query, expectedIntent) => {
    const pack = await builder([result("anchor", {})]).build(
      baseInput({ query }),
    );
    expect(pack.intents.map((intent) => intent.intent)).toContain(
      expectedIntent,
    );
  });

  test("fills an exact character budget boundary", async () => {
    const pack = await builder([
      result("anchor", { content: "a".repeat(256) }),
    ]).build(baseInput({ contextBudget: 256 }));
    expect(pack.budget.usedCharacters).toBe(256);
    expect(pack.budget.remainingCharacters).toBe(0);
    expect(pack.evidence[0]?.truncated).toBe(false);
  });

  test("rejects over-budget supporting evidence without truncating it", async () => {
    const anchor = result("anchor", { content: "a".repeat(200) });
    const supporting = result("support", { content: "b".repeat(100) });
    const pack = await builder([anchor], {
      local: [localCandidate(anchor, supporting, "structural_neighbor")],
    }).build(baseInput({ contextBudget: 256, debug: true }));
    expect(pack.evidence.map((item) => item.source.symbolName)).not.toContain(
      supporting.sourceMetadata.symbolName,
    );
    expect(pack.budget.rejectedItems).toBe(1);
    expect(
      pack.diagnostics?.decisions.some((item) => item.action === "rejected"),
    ).toBe(true);
  });

  test("preserves every primary and deterministically truncates oversized anchors", async () => {
    const pack = await builder([
      result("one", { content: "one\n".repeat(100), path: "src/one.ts" }),
      result("two", { content: "two\n".repeat(100), path: "src/two.ts" }),
    ]).build(baseInput({ limit: 2, contextBudget: 256 }));
    expect(pack.evidence).toHaveLength(2);
    expect(pack.evidence.every((item) => item.contextRole === "PRIMARY")).toBe(
      true,
    );
    expect(pack.evidence.every((item) => item.truncated)).toBe(true);
    expect(pack.budget.usedCharacters).toBeLessThanOrEqual(256);
  });

  test("never admits an entire huge local chunk over the remaining budget", async () => {
    const anchor = result("anchor", { content: "primary" });
    const huge = result("huge", { content: "x".repeat(50_000) });
    const pack = await builder([anchor], {
      local: [localCandidate(anchor, huge, "fallback_line_context")],
    }).build(baseInput({ contextBudget: 1_000 }));
    expect(pack.evidence).toHaveLength(1);
    expect(pack.budget.rejectedItems).toBe(1);
  });
});

describe("Evidence Pack deduplication, isolation, and output", () => {
  test("deduplicates identical chunks and repeated relationship paths", async () => {
    const anchor = result("anchor", {});
    const duplicate = relationshipResult("same", "imports", {
      content: "same content",
      path: "src/same.ts",
    });
    const repeated = relationshipResult("same-again", "imports", {
      content: "same content",
      path: "src/same.ts",
    });
    const pack = await builder([anchor], {
      related: [duplicate, repeated],
    }).build(baseInput({ debug: true }));
    expect(
      pack.evidence.filter((item) => item.content === "same content"),
    ).toHaveLength(1);
    expect(
      pack.diagnostics?.decisions.some(
        (decision) => decision.action === "deduplicated",
      ),
    ).toBe(true);
  });

  test("merges overlapping ranges for the same symbol", async () => {
    const anchor = result("anchor", {});
    const first = relationshipResult("first", "imports", {
      path: "src/shared.ts",
      symbolName: "shared",
      startLine: 10,
      endLine: 12,
      content: "ten\neleven\ntwelve",
    });
    const overlap = relationshipResult("overlap", "imported_by", {
      path: "src/shared.ts",
      symbolName: "shared",
      startLine: 12,
      endLine: 14,
      content: "twelve\nthirteen\nfourteen",
    });
    const pack = await builder([anchor], {
      related: [first, overlap],
    }).build(baseInput({ debug: true }));
    expect(
      pack.evidence.filter((item) => item.source.symbolName === "shared"),
    ).toHaveLength(1);
    expect(
      pack.diagnostics?.decisions.some(
        (decision) => decision.action === "merged",
      ),
    ).toBe(true);
    expect(
      pack.evidence.find((item) => item.source.symbolName === "shared"),
    ).toMatchObject({
      content: "ten\neleven\ntwelve\nthirteen\nfourteen",
      source: { startLine: 10, endLine: 14 },
    });
  });

  test("preserves distinct symbols in the same file", async () => {
    const anchor = result("anchor", {});
    const first = relationshipResult("first", "imports", {
      path: "src/shared.ts",
      symbolName: "first",
      startLine: 1,
      endLine: 5,
    });
    const second = relationshipResult("second", "imports", {
      path: "src/shared.ts",
      symbolName: "second",
      startLine: 4,
      endLine: 8,
    });
    const pack = await builder([anchor], { related: [first, second] }).build(
      baseInput(),
    );
    expect(
      pack.evidence.filter((item) => item.source.path === "src/shared.ts"),
    ).toHaveLength(2);
  });

  test("rejects future source content", async () => {
    const future = result("future", {
      availableAt: new Date("2025-04-01T00:00:00.000Z"),
    });
    await expect(builder([future]).build(baseInput())).rejects.toThrow(
      "future evidence",
    );
  });

  test("rejects cross-repository supporting evidence", async () => {
    const anchor = result("anchor", {});
    const other = relationshipResult("other", "imports", {
      repositoryId: "223e4567-e89b-42d3-a456-426614174000",
    });
    await expect(
      builder([anchor], { related: [other] }).build(baseInput()),
    ).rejects.toThrow("cross-repository");
  });

  test("emits stable JSON and readable human output with debug provenance", async () => {
    const pack = await builder([result("anchor", {})]).build(
      baseInput({ debug: true }),
    );
    const parsed = JSON.parse(formatEvidencePackJson(pack)) as {
      schemaVersion: number;
      cutoff: string;
      evidence: unknown[];
    };
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      cutoff: cutoff.toISOString(),
    });
    expect(parsed.evidence).toHaveLength(1);
    expect(formatEvidencePack(pack)).toContain("Evidence Pack v1");
    expect(formatEvidencePack(pack)).toContain("Debug decisions");
    expect(formatEvidencePack(pack)).toContain("PRIMARY");
  });
});

function builder(
  results: readonly MemorySearchResult[],
  options: {
    local?: readonly LocalContextCandidate[];
    related?: readonly MemorySearchResult[];
    onLocal?: () => void;
    onRelationships?: () => void;
  } = {},
): EvidencePackBuilder {
  const memory: RepositoryMemory = {
    searchMemory: async () => results,
  };
  const evidenceSource: ContextEvidenceSource = {
    loadRepository: async () => ({
      id: repositoryId,
      provider: "test",
      owner: "swega",
      name: "fixture",
      url: "https://example.test/swega/fixture",
      defaultBranch: "main",
    }),
    loadLocalContext: async () => {
      options.onLocal?.();
      return options.local ?? [];
    },
  };
  const relationships: RelationshipExpansion = {
    expand: async () => {
      options.onRelationships?.();
      return options.related ?? [];
    },
  };
  return new EvidencePackBuilder(memory, evidenceSource, relationships);
}

function baseInput(
  overrides: Partial<Parameters<EvidencePackBuilder["build"]>[0]> = {},
) {
  return {
    repositoryId,
    query: "general repository question",
    before: cutoff,
    contextBudget: 10_000,
    ...overrides,
  };
}

function localCandidate(
  anchor: MemorySearchResult,
  supporting: MemorySearchResult,
  reason: LocalContextCandidate["reason"],
): LocalContextCandidate {
  return {
    anchorChunkId: anchor.sourceMetadata.chunkId,
    result: supporting,
    reason,
  };
}

function relationshipResult(
  chunkId: string,
  type: "imports" | "imported_by" | "reexports",
  overrides: ResultOverrides = {},
): MemorySearchResult {
  const related = result(chunkId, overrides);
  return {
    ...related,
    relationshipType: type,
    relationshipSourcePath: "src/anchor.ts",
    relationshipSourceSymbol: "anchor",
    relationshipTargetPath: related.path,
    relationshipTargetSymbol:
      overrides.relationshipTargetSymbol === undefined
        ? related.sourceMetadata.symbolName
        : overrides.relationshipTargetSymbol,
    relationshipDepth: 1,
    relationshipReason: `${type}: src/anchor.ts -> ${related.path}`,
    relationshipRank: 1,
    retrievedDirectly: false,
  };
}

interface ResultOverrides extends Partial<MemorySearchResult> {
  content?: string;
  repositoryId?: string;
  path?: string | null;
  sourceType?: MemorySearchResult["sourceType"];
  availableAt?: Date;
  symbolName?: string | null;
  symbolKind?: MemorySearchResult["sourceMetadata"]["symbolKind"];
  startLine?: number | null;
  endLine?: number | null;
}

function result(
  chunkId: string,
  overrides: ResultOverrides,
): MemorySearchResult {
  const availableAt =
    overrides.availableAt ?? new Date("2025-03-01T00:00:00.000Z");
  const path =
    overrides.path === undefined ? `src/${chunkId}.ts` : overrides.path;
  const symbolName =
    overrides.symbolName === undefined ? chunkId : overrides.symbolName;
  const symbolKind =
    overrides.symbolKind === undefined ? "function" : overrides.symbolKind;
  const sourceType = overrides.sourceType ?? "source_code";
  const base: MemorySearchResult = {
    repositoryId: overrides.repositoryId ?? repositoryId,
    content: overrides.content ?? `content for ${chunkId}`,
    similarity: 0.5,
    sourceType,
    sourceId: "323e4567-e89b-42d3-a456-426614174000",
    timestamp: availableAt,
    path,
    sourceMetadata: {
      documentId: `document-${chunkId}`,
      chunkId,
      sourceReference:
        sourceType === "source_code"
          ? `git:${"a".repeat(40)}:${path}`
          : `provider:test:${sourceType}:${chunkId}`,
      parentSourceType: null,
      parentSourceEntityId: null,
      occurredAt: availableAt,
      availableAt,
      path,
      commitSha: sourceType === "source_code" ? "a".repeat(40) : null,
      startLine: overrides.startLine === undefined ? 1 : overrides.startLine,
      endLine: overrides.endLine === undefined ? 3 : overrides.endLine,
      language: sourceType === "source_code" ? "TypeScript" : null,
      symbolId: symbolName ? `symbol-${chunkId}` : null,
      symbolName,
      symbolKind,
      parentSymbol: null,
      symbolPart: symbolName ? 1 : null,
      symbolPartCount: symbolName ? 1 : null,
    },
  };
  return { ...base, ...overrides, sourceMetadata: base.sourceMetadata };
}

function id(value: MemorySearchResult): string {
  return value.sourceMetadata.chunkId;
}
