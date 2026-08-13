import { describe, expect, test } from "bun:test";

import {
  EvidencePackBuilder,
  type ContextEvidenceSource,
  type MemorySearchResult,
  type RelationshipExpansion,
  type RepositoryMemory,
} from "@swega/retrieval";

import { evaluateContextBenchmark } from "./context-evaluate";
import { formatContextBenchmarkReport } from "./context-format";
import { parseContextBenchmark } from "./context-schema";

const repositoryId = "123e4567-e89b-42d3-a456-426614174000";
const before = new Date("2025-03-15T00:00:00.000Z");

describe("context benchmark evaluation", () => {
  test("compares raw chunks and Evidence Packs under the same budget", async () => {
    const primary = result("primary", "src/primary.ts", "primary", 200);
    const noise = result("noise", "src/noise.ts", "noise", 200);
    const requiredSupport = result(
      "required-support",
      "src/support.ts",
      "support",
      200,
    );
    const memory: RepositoryMemory = {
      searchMemory: async (input) =>
        input.limit === 50 ? [primary, noise] : [primary],
    };
    const source: ContextEvidenceSource = {
      loadRepository: async () => ({
        id: repositoryId,
        provider: "test",
        owner: "swega",
        name: "fixture",
        url: "https://example.test/fixture",
        defaultBranch: "main",
      }),
      loadLocalContext: async () => [],
    };
    const relationships: RelationshipExpansion = {
      expand: async () => [
        {
          ...requiredSupport,
          relationshipType: "imports",
          relationshipSourcePath: "src/primary.ts",
          relationshipSourceSymbol: "primary",
          relationshipTargetPath: "src/support.ts",
          relationshipTargetSymbol: "support",
          relationshipImportedName: "support",
          relationshipLocalName: "support",
          relationshipBindingKind: "named",
          relationshipIsTypeOnly: false,
          relationshipResolution: "exact_symbol",
          relationshipModuleResolutionKind: "path_alias",
          relationshipConfigurationPath: "tsconfig.json",
          relationshipConfigurationCommitSha: "a".repeat(40),
          relationshipDepth: 1,
          relationshipReason: "imports @/support (path_alias, exact_symbol)",
          relationshipRank: 1,
          retrievedDirectly: false,
        },
      ],
    };
    const benchmark = parseContextBenchmark({
      version: 1,
      name: "Context fixture",
      description: "Twenty equivalent development comparison cases.",
      split: "development",
      repositoryRevision: "fixture-revision",
      groundTruthMethod: "Inspected fixture source directly.",
      contextBudget: 400,
      primaryAnchors: 1,
      cases: Array.from({ length: 20 }, (_, index) => ({
        id: `case-${index}`,
        query: "trace primary into support",
        repositoryId,
        before: before.toISOString(),
        category: "cross_file",
        difficulty: "medium",
        notes: "Primary and supporting symbols are both required.",
        required: [
          { path: "src/primary.ts", symbolName: "primary" },
          { path: "src/support.ts", symbolName: "support" },
        ],
        supporting: [],
      })),
    });
    const report = await evaluateContextBenchmark(
      benchmark,
      memory,
      new EvidencePackBuilder(memory, source, relationships),
    );

    expect(report.baseline.requiredEvidenceRecall).toBe(0.5);
    expect(report.evidencePack.requiredEvidenceRecall).toBe(1);
    expect(report.evidencePack.completePack).toBe(1);
    expect(report.baseline.completePack).toBe(0);
    expect(report.baseline.payloadCharacters).toBeLessThanOrEqual(400);
    expect(report.evidencePack.payloadCharacters).toBeLessThanOrEqual(400);
    expect(
      report.evidencePack.meanContextExpansionDurationMs,
    ).toBeGreaterThanOrEqual(0);
    expect(report.evidencePack.relationshipDerivedEvidencePrecision).toBe(1);
    expect(report.evidencePack.exactRelationshipTargetRate).toBe(1);
    expect(report.evidencePack.moduleOnlyFallbackRate).toBe(0);
    expect(formatContextBenchmarkReport(report)).toContain("Evidence Pack");
    expect(formatContextBenchmarkReport(report)).toContain("Chars");
  });
});

function result(
  chunkId: string,
  path: string,
  symbolName: string,
  characters: number,
): MemorySearchResult {
  return {
    repositoryId,
    content: chunkId.padEnd(characters, "x"),
    similarity: 1,
    sourceType: "source_code",
    sourceId: "223e4567-e89b-42d3-a456-426614174000",
    timestamp: before,
    path,
    sourceMetadata: {
      documentId: `document-${chunkId}`,
      chunkId,
      sourceReference: `git:${"a".repeat(40)}:${path}`,
      parentSourceType: null,
      parentSourceEntityId: null,
      occurredAt: before,
      availableAt: before,
      path,
      commitSha: "a".repeat(40),
      startLine: 1,
      endLine: 3,
      language: "TypeScript",
      symbolId: `symbol-${chunkId}`,
      symbolName,
      symbolKind: "function",
      parentSymbol: null,
      symbolPart: 1,
      symbolPartCount: 1,
    },
  };
}
