import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import { z } from "zod";

const rootEnvironmentFile = fileURLToPath(
  new URL("../../../.env", import.meta.url),
);

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

/** Loads SWEGA's canonical root .env without overriding explicit process values. */
export function loadRootEnvironment(): void {
  let values: ReturnType<typeof parseEnv>;
  try {
    values = parseEnv(readFileSync(rootEnvironmentFile, "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) {
      process.env[name] ??= value;
    }
  }
}

export function parseServerEnvironment(
  environment: Record<string, string | undefined>,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(environment);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
