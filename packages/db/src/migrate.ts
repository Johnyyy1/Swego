import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import { parseServerEnvironment } from "@swega/shared/environment";

import { createDatabase } from "./index";

const environment = parseServerEnvironment(process.env);
const database = createDatabase({
  url: environment.DATABASE_URL,
  maxConnections: 1,
});
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

try {
  await migrate(database.db, { migrationsFolder });
} finally {
  await database.close();
}
