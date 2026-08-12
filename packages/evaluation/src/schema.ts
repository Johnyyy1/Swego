import { z } from "zod";

import { memorySourceTypes, repositoryIdSchema } from "@swega/shared";

export const DEFAULT_BENCHMARK_CUTOFFS = [1, 3, 5, 10] as const;

export const benchmarkSplits = ["smoke", "development", "held_out"] as const;
export const benchmarkCategories = [
  "implementation",
  "exact_symbol",
  "feature_flow",
  "configuration",
  "api_endpoint",
  "authorization",
  "database_schema",
  "migration",
  "error_handling",
  "tests",
  "ui_component",
  "utility",
  "cross_file",
  "repository_infrastructure",
  "temporal",
] as const;
export const benchmarkDifficulties = ["easy", "medium", "hard"] as const;

export const relevanceTargetSchema = z
  .object({
    path: z.string().min(1).optional(),
    sourceType: z.enum(memorySourceTypes).optional(),
    sourceReference: z.string().min(1).optional(),
    symbolName: z.string().min(1).optional(),
    grade: z.number().int().min(1).max(3).default(1),
  })
  .strict()
  .refine(
    (target) =>
      target.path !== undefined || target.sourceReference !== undefined,
    "A relevance target must specify path or sourceReference",
  )
  .refine(
    (target) => target.symbolName === undefined || target.path !== undefined,
    "A symbol relevance target must also specify path",
  );

export const retrievalBenchmarkCaseSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9_-]*$/),
    query: z.string().trim().min(1),
    repositoryId: repositoryIdSchema,
    before: z.iso.datetime({ offset: true }).optional(),
    category: z.enum(benchmarkCategories).optional(),
    difficulty: z.enum(benchmarkDifficulties).optional(),
    notes: z.string().trim().min(1).optional(),
    tags: z.array(z.string().min(1)).max(20).optional(),
    relevant: z.array(relevanceTargetSchema).min(1),
  })
  .strict()
  .superRefine((benchmarkCase, context) => {
    const selectors = new Set<string>();
    benchmarkCase.relevant.forEach((target, index) => {
      const selector = JSON.stringify({
        path: target.path ?? null,
        sourceType: target.sourceType ?? null,
        sourceReference: target.sourceReference ?? null,
        symbolName: target.symbolName ?? null,
      });
      if (selectors.has(selector)) {
        context.addIssue({
          code: "custom",
          path: ["relevant", index],
          message: "Duplicate relevance target selector",
        });
      }
      selectors.add(selector);
    });
  });

const cutoffsSchema = z
  .array(z.number().int().min(1).max(100))
  .min(1)
  .max(10)
  .default([...DEFAULT_BENCHMARK_CUTOFFS])
  .superRefine((cutoffs, context) => {
    if (new Set(cutoffs).size !== cutoffs.length) {
      context.addIssue({
        code: "custom",
        message: "Benchmark cutoffs must be unique",
      });
    }
  })
  .transform((cutoffs) => [...cutoffs].sort((left, right) => left - right));

export const retrievalBenchmarkSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    split: z.enum(benchmarkSplits).optional(),
    repositoryRevision: z.string().trim().min(1).optional(),
    groundTruthMethod: z.string().trim().min(1).optional(),
    cutoffs: cutoffsSchema,
    cases: z.array(retrievalBenchmarkCaseSchema).min(1),
  })
  .strict()
  .superRefine((benchmark, context) => {
    const caseIds = new Set<string>();
    benchmark.cases.forEach((benchmarkCase, index) => {
      if (caseIds.has(benchmarkCase.id)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "id"],
          message: `Duplicate benchmark case ID '${benchmarkCase.id}'`,
        });
      }
      caseIds.add(benchmarkCase.id);
    });
    if (benchmark.split && benchmark.split !== "smoke") {
      if (!benchmark.repositoryRevision) {
        context.addIssue({
          code: "custom",
          path: ["repositoryRevision"],
          message:
            "Development and held-out benchmarks require a repository revision",
        });
      }
      if (!benchmark.groundTruthMethod) {
        context.addIssue({
          code: "custom",
          path: ["groundTruthMethod"],
          message:
            "Development and held-out benchmarks require a ground-truth method",
        });
      }
      benchmark.cases.forEach((benchmarkCase, index) => {
        for (const field of ["category", "difficulty", "notes"] as const) {
          if (!benchmarkCase[field]) {
            context.addIssue({
              code: "custom",
              path: ["cases", index, field],
              message: `Development and held-out cases require ${field}`,
            });
          }
        }
      });
    }
  });

export type RelevanceTarget = z.infer<typeof relevanceTargetSchema>;
export type RetrievalBenchmarkCase = z.infer<
  typeof retrievalBenchmarkCaseSchema
>;
export type RetrievalBenchmark = z.infer<typeof retrievalBenchmarkSchema>;

export class BenchmarkValidationError extends Error {
  override readonly name = "BenchmarkValidationError";
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(issues: readonly z.core.$ZodIssue[]) {
    super(
      `Invalid retrieval benchmark: ${issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "root";
          return `${path}: ${issue.message}`;
        })
        .join("; ")}`,
    );
    this.issues = issues;
  }
}

export function parseRetrievalBenchmark(input: unknown): RetrievalBenchmark {
  const result = retrievalBenchmarkSchema.safeParse(input);
  if (!result.success) {
    throw new BenchmarkValidationError(result.error.issues);
  }
  return result.data;
}
