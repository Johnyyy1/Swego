import { z } from "zod";

import { repositoryIdSchema } from "@swega/shared";

import {
  benchmarkCategories,
  benchmarkDifficulties,
  relevanceTargetSchema,
} from "./schema";

const contextBenchmarkCaseSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9_-]*$/),
    query: z.string().trim().min(1),
    repositoryId: repositoryIdSchema,
    before: z.iso.datetime({ offset: true }).optional(),
    category: z.enum(benchmarkCategories),
    difficulty: z.enum(benchmarkDifficulties),
    notes: z.string().trim().min(1),
    required: z.array(relevanceTargetSchema).min(1),
    supporting: z.array(relevanceTargetSchema).default([]),
    irrelevant: z.array(relevanceTargetSchema).default([]),
  })
  .strict()
  .superRefine((benchmarkCase, context) => {
    const selectors = new Set<string>();
    for (const field of ["required", "supporting", "irrelevant"] as const) {
      benchmarkCase[field].forEach((target, index) => {
        const selector = JSON.stringify({
          path: target.path ?? null,
          sourceType: target.sourceType ?? null,
          sourceReference: target.sourceReference ?? null,
          symbolName: target.symbolName ?? null,
        });
        if (selectors.has(selector)) {
          context.addIssue({
            code: "custom",
            path: [field, index],
            message: "Duplicate context evidence target selector",
          });
        }
        selectors.add(selector);
      });
    }
  });

export const contextBenchmarkSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    split: z.literal("development"),
    repositoryRevision: z.string().trim().min(1),
    groundTruthMethod: z.string().trim().min(1),
    contextBudget: z.number().int().min(256).max(1_000_000),
    primaryAnchors: z.number().int().min(1).max(5).default(5),
    cases: z.array(contextBenchmarkCaseSchema).min(20).max(30),
  })
  .strict()
  .superRefine((benchmark, context) => {
    const ids = new Set<string>();
    benchmark.cases.forEach((benchmarkCase, index) => {
      if (ids.has(benchmarkCase.id)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "id"],
          message: `Duplicate context benchmark case ID '${benchmarkCase.id}'`,
        });
      }
      ids.add(benchmarkCase.id);
    });
  });

export type ContextBenchmark = z.infer<typeof contextBenchmarkSchema>;
export type ContextBenchmarkCase = z.infer<typeof contextBenchmarkCaseSchema>;

export class ContextBenchmarkValidationError extends Error {
  override readonly name = "ContextBenchmarkValidationError";
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(issues: readonly z.core.$ZodIssue[]) {
    super(
      `Invalid context benchmark: ${issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "root";
          return `${path}: ${issue.message}`;
        })
        .join("; ")}`,
    );
    this.issues = issues;
  }
}

export function parseContextBenchmark(input: unknown): ContextBenchmark {
  const result = contextBenchmarkSchema.safeParse(input);
  if (!result.success) {
    throw new ContextBenchmarkValidationError(result.error.issues);
  }
  return result.data;
}
