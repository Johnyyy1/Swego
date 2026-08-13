import { describe, expect, test } from "bun:test";

import { EmbeddingProviderError } from "@swega/embeddings";
import type { EvidencePack } from "@swega/retrieval";

import { AgentContextError } from "./errors";
import {
  DEFAULT_AGENT_CONTEXT_BUDGET,
  MAX_AGENT_CONTEXT_BUDGET,
  MIN_AGENT_CONTEXT_BUDGET,
  AgentContextService,
} from "./service";
import type {
  AgentRepository,
  AgentRepositoryStore,
  EvidencePackBuilderPort,
} from "./types";

const repositoryId = "123e4567-e89b-42d3-a456-426614174000";
const otherRepositoryId = "223e4567-e89b-42d3-a456-426614174000";
const cutoff = new Date("2025-03-15T00:00:00.000Z");

describe("AgentContextService", () => {
  test("lists repositories in deterministic canonical order", async () => {
    const service = createService({
      repositories: [
        repository(otherRepositoryId, { owner: "zeta", repositoryName: "z" }),
        repository(repositoryId, { owner: "alpha", repositoryName: "a" }),
      ],
    });
    const first = await service.listRepositories();
    const second = await service.listRepositories();
    expect(first.map((item) => item.repositoryId)).toEqual([
      repositoryId,
      otherRepositoryId,
    ]);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  test("gets an existing repository and rejects invalid or missing IDs", async () => {
    const service = createService();
    expect((await service.getRepository(repositoryId)).name).toBe("owner/repo");
    await expect(service.getRepository("not-a-uuid")).rejects.toMatchObject({
      code: "INVALID_REPOSITORY_ID",
    });
    await expect(
      service.getRepository(otherRepositoryId),
    ).rejects.toMatchObject({ code: "REPOSITORY_NOT_FOUND" });
  });

  test("builds bounded context through the standard builder", async () => {
    const builder = new RecordingBuilder();
    const service = createService({ builder });
    const pack = await service.buildContext(
      {
        repositoryId,
        query: "  how is authentication validated?  ",
        before: cutoff,
        contextBudget: 12_000,
        rerank: false,
      },
      { primaryEvidenceLimit: 3 },
    );
    expect(pack).toMatchObject({
      schemaVersion: 1,
      query: "how is authentication validated?",
      cutoff,
      budget: { maximumCharacters: 12_000 },
    });
    expect(builder.inputs).toEqual([
      {
        repositoryId,
        query: "how is authentication validated?",
        before: cutoff,
        contextBudget: 12_000,
        limit: 3,
      },
    ]);
  });

  test("rejects empty, whitespace, and oversized queries", async () => {
    const service = createService();
    for (const query of ["", "   ", "x".repeat(4_001)]) {
      await expect(
        service.buildContext({ repositoryId, query }),
      ).rejects.toMatchObject({ code: "INVALID_QUERY" });
    }
  });

  test("rejects invalid repositories before context construction", async () => {
    const builder = new RecordingBuilder();
    const service = createService({ builder });
    await expect(
      service.buildContext({ repositoryId: "invalid", query: "question" }),
    ).rejects.toMatchObject({ code: "INVALID_REPOSITORY_ID" });
    await expect(
      service.buildContext({
        repositoryId: otherRepositoryId,
        query: "question",
      }),
    ).rejects.toMatchObject({ code: "REPOSITORY_NOT_FOUND" });
    expect(builder.inputs).toHaveLength(0);
  });

  test("rejects repositories whose configured memory projection is not ready", async () => {
    const service = createService({
      repositories: [repository(repositoryId, { ready: false })],
    });
    await expect(
      service.buildContext({ repositoryId, query: "question" }),
    ).rejects.toMatchObject({ code: "REPOSITORY_MEMORY_NOT_READY" });
  });

  test("accepts valid budgets and rejects values outside the server bounds", async () => {
    const service = createService();
    await expect(
      service.buildContext({
        repositoryId,
        query: "question",
        contextBudget: MIN_AGENT_CONTEXT_BUDGET,
      }),
    ).resolves.toMatchObject({
      budget: { maximumCharacters: MIN_AGENT_CONTEXT_BUDGET },
    });
    for (const contextBudget of [
      MIN_AGENT_CONTEXT_BUDGET - 1,
      MAX_AGENT_CONTEXT_BUDGET + 1,
      1.5,
      Number.POSITIVE_INFINITY,
      Number.NaN,
    ]) {
      await expect(
        service.buildContext({
          repositoryId,
          query: "question",
          contextBudget,
        }),
      ).rejects.toMatchObject({ code: "INVALID_CONTEXT_BUDGET" });
    }
  });

  test("rejects a malformed temporal cutoff", async () => {
    const service = createService();
    await expect(
      service.buildContext({
        repositoryId,
        query: "question",
        before: new Date("invalid"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_TEMPORAL_CUTOFF" });
  });

  test("uses reranking only when explicitly requested", async () => {
    const standard = new RecordingBuilder();
    const reranked = new RecordingBuilder();
    const service = createService({
      builder: standard,
      rerankedBuilder: reranked,
    });
    await service.buildContext({ repositoryId, query: "first" });
    await service.buildContext({ repositoryId, query: "second", rerank: true });
    expect(standard.inputs).toHaveLength(1);
    expect(reranked.inputs).toHaveLength(1);
  });

  test("does not silently downgrade unavailable reranking", async () => {
    const service = createService();
    await expect(
      service.buildContext({ repositoryId, query: "question", rerank: true }),
    ).rejects.toMatchObject({ code: "RERANKER_UNAVAILABLE" });
  });

  test("maps embedding provider failures without exposing their causes", async () => {
    const service = createService({
      builder: new RecordingBuilder(
        new EmbeddingProviderError(
          "ollama",
          "local-model",
          "unavailable",
          "secret provider detail",
        ),
      ),
    });
    const error = await captureError(() =>
      service.buildContext({ repositoryId, query: "question" }),
    );
    expect(error).toMatchObject({
      code: "EMBEDDING_PROVIDER_UNAVAILABLE",
      message: "The configured embedding provider is unavailable.",
      details: { provider: "ollama", model: "local-model" },
    });
    expect(error.message).not.toContain("secret");
  });

  test("maps wrapped database failures without exposing their causes", async () => {
    const connectionFailure = Object.assign(new Error("secret database URL"), {
      code: "ECONNREFUSED",
    });
    const queryFailure = Object.assign(new Error("query failed"), {
      cause: connectionFailure,
    });
    const service = createService({
      builder: new RecordingBuilder(queryFailure),
    });
    const error = await captureError(() =>
      service.buildContext({ repositoryId, query: "question" }),
    );
    expect(error).toMatchObject({
      code: "DATABASE_UNAVAILABLE",
      message: "The SWEGA database is unavailable.",
    });
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  test("rejects cross-repository and future Evidence Packs", async () => {
    const wrongRepository = new RecordingBuilder(undefined, (input) =>
      pack({ ...input, repositoryId: otherRepositoryId }),
    );
    await expect(
      createService({ builder: wrongRepository }).buildContext({
        repositoryId,
        query: "question",
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });

    const future = new RecordingBuilder(undefined, (input) => {
      const result = pack(input);
      result.evidence[0]!.source.availableAt = new Date(
        "2025-03-16T00:00:00.000Z",
      );
      return result;
    });
    await expect(
      createService({ builder: future }).buildContext({
        repositoryId,
        query: "question",
        before: cutoff,
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  test("keeps concurrent requests and cutoffs independent", async () => {
    const builder = new RecordingBuilder();
    const service = createService({ builder });
    const earlier = new Date("2025-01-01T00:00:00.000Z");
    const later = new Date("2025-02-01T00:00:00.000Z");
    const [first, second, invalid] = await Promise.allSettled([
      service.buildContext({ repositoryId, query: "first", before: earlier }),
      service.buildContext({ repositoryId, query: "second", before: later }),
      service.buildContext({ repositoryId, query: "   " }),
    ]);
    expect(first).toMatchObject({
      status: "fulfilled",
      value: { cutoff: earlier },
    });
    expect(second).toMatchObject({
      status: "fulfilled",
      value: { cutoff: later },
    });
    expect(invalid).toMatchObject({
      status: "rejected",
      reason: { code: "INVALID_QUERY" },
    });
    expect(builder.inputs.map((input) => [input.query, input.before])).toEqual([
      ["first", earlier],
      ["second", later],
    ]);
  });
});

class RecordingBuilder implements EvidencePackBuilderPort {
  readonly inputs: Parameters<EvidencePackBuilderPort["build"]>[0][] = [];

  constructor(
    private readonly failure?: unknown,
    private readonly buildPack: (
      input: Parameters<EvidencePackBuilderPort["build"]>[0],
    ) => EvidencePack = pack,
  ) {}

  async build(
    input: Parameters<EvidencePackBuilderPort["build"]>[0],
  ): Promise<EvidencePack> {
    this.inputs.push(input);
    if (this.failure) throw this.failure;
    return this.buildPack(input);
  }
}

function createService(
  options: {
    repositories?: readonly AgentRepository[];
    builder?: EvidencePackBuilderPort;
    rerankedBuilder?: EvidencePackBuilderPort;
  } = {},
): AgentContextService {
  const repositories = options.repositories ?? [repository(repositoryId)];
  const store: AgentRepositoryStore = {
    listRepositories: async () => repositories,
    getRepository: async (id) =>
      repositories.find((repository_) => repository_.repositoryId === id) ??
      null,
  };
  return new AgentContextService({
    repositories: store,
    contextBuilder: options.builder ?? new RecordingBuilder(),
    ...(options.rerankedBuilder
      ? { rerankedContextBuilder: options.rerankedBuilder }
      : {}),
  });
}

function repository(
  id: string,
  overrides: Partial<AgentRepository> = {},
): AgentRepository {
  const owner = overrides.owner ?? "owner";
  const repositoryName = overrides.repositoryName ?? "repo";
  const ready = overrides.ready ?? true;
  return {
    repositoryId: id,
    name: `${owner}/${repositoryName}`,
    owner,
    repositoryName,
    provider: "github",
    url: `https://github.com/${owner}/${repositoryName}`,
    defaultBranch: "main",
    revision: "abc123",
    memoryStatus: ready ? "ready" : "not_ready",
    ready,
    indexedAt: cutoff,
    gitIndexedAt: cutoff,
    memoryIndexedAt: cutoff,
    temporalCoverage: {
      earliestAvailableAt: new Date("2024-01-01T00:00:00.000Z"),
      latestAvailableAt: cutoff,
    },
    ...overrides,
  };
}

function pack(
  input: Parameters<EvidencePackBuilderPort["build"]>[0],
): EvidencePack {
  const effectiveCutoff = input.before ?? cutoff;
  const maximumCharacters = input.contextBudget ?? DEFAULT_AGENT_CONTEXT_BUDGET;
  return {
    schemaVersion: 1,
    repository: {
      id: input.repositoryId,
      provider: "github",
      owner: "owner",
      name: "repo",
      url: "https://github.com/owner/repo",
      defaultBranch: "main",
    },
    query: input.query,
    cutoff: effectiveCutoff,
    revisions: ["abc123"],
    intents: [{ intent: "implementation", confidence: 1, evidence: ["test"] }],
    evidence: [
      {
        order: 1,
        contextRole: "PRIMARY",
        reasons: [{ kind: "retrieved_primary", detail: "rank 1" }],
        source: {
          sourceType: "source_code",
          sourceReference: "git:abc123:src/auth.ts",
          parentSourceType: null,
          occurredAt: effectiveCutoff,
          availableAt: effectiveCutoff,
          path: "src/auth.ts",
          commitSha: "abc123",
          startLine: 1,
          endLine: 2,
          language: "TypeScript",
          symbolName: "authenticate",
          symbolKind: "function",
          parentSymbol: null,
          symbolPart: 1,
          symbolPartCount: 1,
          sourceRole: "production_implementation",
        },
        retrieval: { rank: 1, exactSymbolMatch: true },
        relationships: [],
        content: "export function authenticate() {}",
        contentCharacters: 33,
        originalContentCharacters: 33,
        truncated: false,
      },
    ],
    budget: {
      maximumCharacters,
      usedCharacters: 33,
      remainingCharacters: maximumCharacters - 33,
      estimatedTokens: 9,
      truncatedItems: 0,
      rejectedItems: 0,
    },
    ...(input.debug
      ? {
          diagnostics: {
            decisions: [],
            timings: {
              searchDurationMs: 1,
              contextExpansionDurationMs: 1,
              totalDurationMs: 2,
              rerankingDurationMs: 0,
              totalExcludingRerankerMs: 2,
            },
          },
        }
      : {}),
  };
}

async function captureError(
  operation: () => Promise<unknown>,
): Promise<AgentContextError> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof AgentContextError) return error;
    throw error;
  }
  throw new Error("Expected operation to fail");
}
