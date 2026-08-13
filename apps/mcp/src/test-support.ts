import {
  AgentContextError,
  AgentContextService,
  DEFAULT_AGENT_CONTEXT_BUDGET,
  type AgentContextResponse,
  type AgentRepository,
  type EvidencePackBuilderPort,
} from "@swega/agent-context";

export const fixtureRepositoryId = "123e4567-e89b-42d3-a456-426614174000";
export const fixtureOtherRepositoryId = "223e4567-e89b-42d3-a456-426614174000";

export function createFixtureAgentContextService(): AgentContextService {
  const repositories = [
    fixtureRepository(fixtureRepositoryId, "alpha"),
    fixtureRepository(fixtureOtherRepositoryId, "beta"),
  ];
  const builder: EvidencePackBuilderPort = {
    build: async (input) => fixturePack(input),
  };
  return new AgentContextService({
    repositories: {
      listRepositories: async () => repositories,
      getRepository: async (repositoryId) =>
        repositories.find(
          (repository) => repository.repositoryId === repositoryId,
        ) ?? null,
    },
    contextBuilder: builder,
  });
}

export function fixtureRepository(
  repositoryId: string,
  repositoryName: string,
): AgentRepository {
  const availableAt = new Date("2025-03-01T00:00:00.000Z");
  return {
    repositoryId,
    name: `fixture/${repositoryName}`,
    owner: "fixture",
    repositoryName,
    provider: "test",
    url: `https://example.test/fixture/${repositoryName}`,
    defaultBranch: "main",
    revision: `${repositoryName}-revision`,
    memoryStatus: "ready",
    ready: true,
    indexedAt: availableAt,
    gitIndexedAt: availableAt,
    memoryIndexedAt: availableAt,
    temporalCoverage: {
      earliestAvailableAt: new Date("2024-01-01T00:00:00.000Z"),
      latestAvailableAt: availableAt,
    },
  };
}

function fixturePack(
  input: Parameters<EvidencePackBuilderPort["build"]>[0],
): AgentContextResponse {
  const repositoryName =
    input.repositoryId === fixtureRepositoryId ? "alpha" : "beta";
  const cutoff = input.before ?? new Date("2025-03-15T00:00:00.000Z");
  const availableAt = new Date(
    Math.min(cutoff.getTime(), new Date("2025-03-01T00:00:00.000Z").getTime()),
  );
  const path = `src/${repositoryName}/authentication.ts`;
  const content = `export function authenticate${repositoryName}() { return true; }`;
  const maximumCharacters = input.contextBudget ?? DEFAULT_AGENT_CONTEXT_BUDGET;
  if (availableAt.getTime() > cutoff.getTime()) {
    throw new AgentContextError(
      "INTERNAL_ERROR",
      "Fixture temporal invariant failed.",
    );
  }
  return {
    schemaVersion: 1,
    repository: {
      id: input.repositoryId,
      provider: "test",
      owner: "fixture",
      name: repositoryName,
      url: `https://example.test/fixture/${repositoryName}`,
      defaultBranch: "main",
    },
    query: input.query,
    cutoff,
    revisions: [`${repositoryName}-revision`],
    intents: [
      {
        intent: "authentication",
        confidence: 0.9,
        evidence: ["authentication terminology"],
      },
    ],
    evidence: [
      {
        order: 1,
        contextRole: "PRIMARY",
        reasons: [
          {
            kind: "retrieved_primary",
            detail: "selected from final retrieval rank 1",
          },
        ],
        source: {
          sourceType: "source_code",
          sourceReference: `git:${repositoryName}-revision:${path}`,
          parentSourceType: null,
          occurredAt: availableAt,
          availableAt,
          path,
          commitSha: `${repositoryName}-revision`,
          startLine: 1,
          endLine: 1,
          language: "TypeScript",
          symbolName: `authenticate${repositoryName}`,
          symbolKind: "function",
          parentSymbol: null,
          symbolPart: 1,
          symbolPartCount: 1,
          sourceRole: "production_implementation",
        },
        retrieval: { rank: 1, exactSymbolMatch: true },
        relationships: [],
        content,
        contentCharacters: [...content].length,
        originalContentCharacters: [...content].length,
        truncated: false,
      },
    ],
    budget: {
      maximumCharacters,
      usedCharacters: [...content].length,
      remainingCharacters: maximumCharacters - [...content].length,
      estimatedTokens: Math.ceil([...content].length / 4),
      truncatedItems: 0,
      rejectedItems: 0,
    },
  };
}
