import { z } from "zod";

import {
  DEFAULT_CONTEXT_BUDGET,
  EVIDENCE_PACK_SCHEMA_VERSION,
  MAX_CONTEXT_PRIMARY_ANCHORS,
} from "@swega/retrieval";
import { repositoryIdSchema } from "@swega/shared";

import {
  AgentContextError,
  databaseUnavailable,
  mapAgentContextFailure,
} from "./errors";
import type {
  AgentContextBuildOptions,
  AgentContextRequest,
  AgentContextResponse,
  AgentRepository,
  AgentRepositoryStore,
  EvidencePackBuilderPort,
} from "./types";

export const MIN_AGENT_CONTEXT_BUDGET = 256;
export const DEFAULT_AGENT_CONTEXT_BUDGET = DEFAULT_CONTEXT_BUDGET;
export const MAX_AGENT_CONTEXT_BUDGET = 100_000;
export const MAX_AGENT_CONTEXT_QUERY_CHARACTERS = 4_000;
export const AGENT_CONTEXT_SCHEMA_VERSION = EVIDENCE_PACK_SCHEMA_VERSION;

const contextRequestSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  query: z
    .string()
    .max(MAX_AGENT_CONTEXT_QUERY_CHARACTERS)
    .refine((value) => value.trim().length > 0),
  before: z.date().optional(),
  contextBudget: z
    .number()
    .int()
    .min(MIN_AGENT_CONTEXT_BUDGET)
    .max(MAX_AGENT_CONTEXT_BUDGET)
    .optional(),
  rerank: z.boolean().optional(),
});

const buildOptionsSchema = z.strictObject({
  primaryEvidenceLimit: z
    .number()
    .int()
    .min(1)
    .max(MAX_CONTEXT_PRIMARY_ANCHORS)
    .optional(),
  debug: z.boolean().optional(),
});

export interface AgentContextServiceDependencies {
  repositories: AgentRepositoryStore;
  contextBuilder: EvidencePackBuilderPort;
  rerankedContextBuilder?: EvidencePackBuilderPort;
}

export class AgentContextService {
  constructor(private readonly dependencies: AgentContextServiceDependencies) {}

  async listRepositories(): Promise<readonly AgentRepository[]> {
    try {
      const repositories =
        await this.dependencies.repositories.listRepositories();
      return [...repositories].sort(
        (left, right) =>
          left.provider.localeCompare(right.provider) ||
          left.owner.localeCompare(right.owner) ||
          left.repositoryName.localeCompare(right.repositoryName) ||
          left.repositoryId.localeCompare(right.repositoryId),
      );
    } catch (error) {
      throw databaseUnavailable(error);
    }
  }

  async getRepository(repositoryId: string): Promise<AgentRepository> {
    const parsedRepositoryId = parseRepositoryId(repositoryId);
    let repository: AgentRepository | null;
    try {
      repository =
        await this.dependencies.repositories.getRepository(parsedRepositoryId);
    } catch (error) {
      throw databaseUnavailable(error);
    }
    if (!repository) {
      throw new AgentContextError(
        "REPOSITORY_NOT_FOUND",
        `Repository '${parsedRepositoryId}' is not registered in SWEGA.`,
      );
    }
    return repository;
  }

  async buildContext(
    request: AgentContextRequest,
    options: AgentContextBuildOptions = {},
  ): Promise<AgentContextResponse> {
    const parsed = parseContextRequest(request);
    const parsedOptions = parseBuildOptions(options);
    const repository = await this.getRepository(parsed.repositoryId);
    if (!repository.ready) {
      throw new AgentContextError(
        "REPOSITORY_MEMORY_NOT_READY",
        `Repository '${repository.name}' does not have ready memory for the configured embedding projection.`,
        { details: { repositoryId: repository.repositoryId } },
      );
    }
    const builder = parsed.rerank
      ? this.dependencies.rerankedContextBuilder
      : this.dependencies.contextBuilder;
    if (!builder) {
      throw new AgentContextError(
        "RERANKER_UNAVAILABLE",
        "Reranking was requested, but no reranker is configured.",
      );
    }

    try {
      const pack = await builder.build({
        repositoryId: parsed.repositoryId,
        query: parsed.query.trim(),
        ...(parsed.before ? { before: parsed.before } : {}),
        ...(parsed.contextBudget
          ? { contextBudget: parsed.contextBudget }
          : {}),
        ...(parsedOptions.primaryEvidenceLimit
          ? { limit: parsedOptions.primaryEvidenceLimit }
          : {}),
        ...(parsedOptions.debug ? { debug: true } : {}),
      });
      assertPublicPackInvariants(pack, parsed, parsedOptions);
      return pack;
    } catch (error) {
      throw mapAgentContextFailure(error);
    }
  }
}

function parseRepositoryId(repositoryId: string): string {
  const result = repositoryIdSchema.safeParse(repositoryId);
  if (!result.success) {
    throw new AgentContextError(
      "INVALID_REPOSITORY_ID",
      "repositoryId must be a valid UUID.",
    );
  }
  return result.data;
}

function parseContextRequest(request: AgentContextRequest) {
  const result = contextRequestSchema.safeParse(request);
  if (result.success) return result.data;
  const path = result.error.issues[0]?.path[0];
  const code =
    path === "repositoryId"
      ? "INVALID_REPOSITORY_ID"
      : path === "query"
        ? "INVALID_QUERY"
        : path === "contextBudget"
          ? "INVALID_CONTEXT_BUDGET"
          : path === "before"
            ? "INVALID_TEMPORAL_CUTOFF"
            : "INVALID_REQUEST";
  const message =
    code === "INVALID_REPOSITORY_ID"
      ? "repositoryId must be a valid UUID."
      : code === "INVALID_QUERY"
        ? `query must contain between 1 and ${MAX_AGENT_CONTEXT_QUERY_CHARACTERS} characters.`
        : code === "INVALID_CONTEXT_BUDGET"
          ? `contextBudget must be an integer between ${MIN_AGENT_CONTEXT_BUDGET} and ${MAX_AGENT_CONTEXT_BUDGET} characters.`
          : code === "INVALID_TEMPORAL_CUTOFF"
            ? "before must be a valid date."
            : "The context request is invalid.";
  throw new AgentContextError(code, message, { cause: result.error });
}

function parseBuildOptions(options: AgentContextBuildOptions) {
  const result = buildOptionsSchema.safeParse(options);
  if (result.success) return result.data;
  throw new AgentContextError(
    "INVALID_REQUEST",
    `primaryEvidenceLimit must be an integer between 1 and ${MAX_CONTEXT_PRIMARY_ANCHORS}, and debug must be a boolean.`,
    { cause: result.error },
  );
}

function assertPublicPackInvariants(
  pack: AgentContextResponse,
  request: z.infer<typeof contextRequestSchema>,
  options: z.infer<typeof buildOptionsSchema>,
): void {
  if (
    pack.schemaVersion !== AGENT_CONTEXT_SCHEMA_VERSION ||
    pack.repository.id !== request.repositoryId ||
    (request.before && pack.cutoff.getTime() !== request.before.getTime()) ||
    (request.contextBudget !== undefined &&
      pack.budget.maximumCharacters !== request.contextBudget) ||
    pack.budget.maximumCharacters > MAX_AGENT_CONTEXT_BUDGET ||
    pack.budget.usedCharacters > pack.budget.maximumCharacters ||
    (!options.debug && pack.diagnostics !== undefined) ||
    pack.evidence.some(
      (item) => item.source.availableAt.getTime() > pack.cutoff.getTime(),
    )
  ) {
    throw new AgentContextError(
      "INTERNAL_ERROR",
      "SWEGA produced an invalid Evidence Pack.",
    );
  }
}
