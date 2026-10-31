import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type { Pool, PoolClient } from "pg";

export type Database = ReturnType<typeof createDatabase>["db"];

/**
 * Steg 54 (ADR-0177): en pool per slags arbete. `max` begränsar hur många anslutningar poolen tar av databasens 100, så
 * att publikens pool aldrig tar tävlingens. `statementTimeoutMs`, `lockTimeoutMs` och `idleInTransactionTimeoutMs`
 * gäller varje anslutning i poolen (publikens frågor avbryts i stället för att hålla databasen). `applicationName`
 * syns i `pg_stat_activity`.
 */
export type DatabaseOptions = {
  readonly max?: number;
  readonly statementTimeoutMs?: number;
  readonly lockTimeoutMs?: number;
  readonly idleInTransactionTimeoutMs?: number;
  readonly applicationName?: string;
};

export function createDatabase(connectionString: string, options: DatabaseOptions = {}) {
  const pool = new Pool({ connectionString,
    ...(options.max !== undefined ? { max: options.max } : {}),
    ...(options.statementTimeoutMs !== undefined ? { statement_timeout: options.statementTimeoutMs } : {}),
    ...(options.lockTimeoutMs !== undefined ? { lock_timeout: options.lockTimeoutMs } : {}),
    ...(options.idleInTransactionTimeoutMs !== undefined ? { idle_in_transaction_session_timeout: options.idleInTransactionTimeoutMs } : {}),
    ...(options.applicationName !== undefined ? { application_name: options.applicationName } : {}) });
  return { db: drizzle(pool, { schema }), pool };
}

export * as schema from "./schema";
export type { RouteChoicePublished, RouteChoicePublishedCourse } from "./schema/planning";
export { migrate } from "./migrator";
