import { parseServerEnvironment } from "@swega/shared/environment";

export function getWebEnvironment() {
  return parseServerEnvironment(process.env);
}
