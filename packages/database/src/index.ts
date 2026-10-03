import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type { Pool, PoolClient } from "pg";

export type Database = ReturnType<typeof createDatabase>["db"];

export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}

export * as schema from "./schema";
