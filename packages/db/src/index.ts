import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export interface DatabaseConfig {
  url: string;
  maxConnections?: number;
}

export function createDatabase(config: DatabaseConfig) {
  const client = postgres(config.url, {
    max: config.maxConnections ?? 10,
  });

  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];
export * from "./schema";
