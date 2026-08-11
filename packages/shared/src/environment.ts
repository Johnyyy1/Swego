import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const serverEnvironmentSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => /^postgres(?:ql)?:\/\//u.test(value), {
      message: "DATABASE_URL must be a PostgreSQL connection URL",
    }),
  GITHUB_TOKEN: optionalNonEmptyString,
  OPENAI_API_KEY: optionalNonEmptyString,
  SWEGA_EMBEDDING_MODEL: optionalNonEmptyString,
  SWEGA_REPOSITORY_DIR: optionalNonEmptyString,
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function parseServerEnvironment(
  environment: Record<string, string | undefined>,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(environment);
}
