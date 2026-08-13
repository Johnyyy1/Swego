import { SOLVER_CONFIGURATION } from "./config.ts";
import type { RunResult } from "./types.ts";

export const shouldRetryRun = (
  result: Pick<RunResult, "infrastructureFailure">,
  retryNumber: number,
): boolean =>
  result.infrastructureFailure?.verified === true &&
  retryNumber < SOLVER_CONFIGURATION.retryPolicy.maximumRetries;
