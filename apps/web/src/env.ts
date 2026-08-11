import {
  loadRootEnvironment,
  parseServerEnvironment,
} from "@swega/shared/environment";

export function getWebEnvironment() {
  loadRootEnvironment();
  return parseServerEnvironment(process.env);
}
