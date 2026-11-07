import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type { Pool, PoolClient } from "pg";
export type { ClubCourseFileSummary, ClubMapMergeAbsorbed } from "./schema/clubs";
export { ACCOUNT_REQUEST_THROTTLE_SCOPES, type AccountRequestThrottleScope } from "./schema/accounts";

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
  const db = drizzle(pool, { schema });
  retryTopLevelTransactions(db);
  return { db, pool };
}

/** PostgreSQL avbröt transaktionen för en samtidig ändring: 40001 (serialisering) eller 40P01 (dödläge). */
export function isTransactionConflict(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 6; current = (current as { cause?: unknown }).cause, depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (code === "40001" || code === "40P01") return true;
  }
  return false;
}

const TRANSACTION_ATTEMPTS = 3;

/**
 * Översynen 2026-11-02: en transaktion som PostgreSQL avbröt med 40001 eller 40P01 har rullats tillbaka helt och görs om,
 * högst tre försök med växande väntan (med lite slump). Gäller bara poolens egna transaktioner; en savepoint i en
 * transaktion (`tx.transaction`) görs inte om, eftersom hela den yttre transaktionen redan är avbruten.
 * Transaktionens funktion får därför inte ha sidoeffekter utanför databasen (det har ingen i O-Tid).
 */
export function retryTopLevelTransactions(db: { transaction: (...args: never[]) => Promise<unknown> }): void {
  const original = db.transaction.bind(db);
  const retrying = async (...args: Parameters<typeof original>) => {
    for (let attempt = 1; ; attempt += 1) {
      try { return await original(...args); } catch (error) {
        if (attempt >= TRANSACTION_ATTEMPTS || !isTransactionConflict(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 40)));
      }
    }
  };
  db.transaction = retrying as unknown as typeof db.transaction;
}

export * as schema from "./schema";
export type { RouteChoicePublished, RouteChoicePublishedCourse } from "./schema/planning";
export { migrate } from "./migrator";
