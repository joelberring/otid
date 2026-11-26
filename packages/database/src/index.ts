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
  readonly connectionTimeoutMillis?: number;
  readonly statementTimeoutMs?: number;
  readonly lockTimeoutMs?: number;
  readonly idleInTransactionTimeoutMs?: number;
  readonly applicationName?: string;
};

export function createDatabase(connectionString: string, options: DatabaseOptions = {}) {
  const pool = new Pool({ connectionString,
    ...(options.max !== undefined ? { max: options.max } : {}),
    ...(options.connectionTimeoutMillis !== undefined ? { connectionTimeoutMillis: options.connectionTimeoutMillis } : {}),
    ...(options.statementTimeoutMs !== undefined ? { statement_timeout: options.statementTimeoutMs } : {}),
    ...(options.lockTimeoutMs !== undefined ? { lock_timeout: options.lockTimeoutMs } : {}),
    ...(options.idleInTransactionTimeoutMs !== undefined ? { idle_in_transaction_session_timeout: options.idleInTransactionTimeoutMs } : {}),
    ...(options.applicationName !== undefined ? { application_name: options.applicationName } : {}) });
  // Fångar oväntade fel på vilande anslutningar (t.ex. vid PostgreSQL-omstart) så Node-processen inte kraschar på unhandled error.
  pool.on("error", (error: Error) => {
    const label = options.applicationName ?? "otid";
    console.error(`[database:${label}] Fel på vilande databasanslutning:`, error.message);
  });
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
/** Så många gånger en transaktion får göras om för arbete utanför den (`OutsideTransactionWork`). */
const OUTSIDE_WORK_ROUNDS = 6;
const OUTSIDE_WORK = Symbol.for("otid.outside-transaction-work");

/**
 * Granskningen runda 2 (A): arbete som inte får göras i en transaktion (nätverk mot objektlagringen, filer) men som
 * transaktionen behöver. Transaktionens funktion kastar felet, transaktionen rullas tillbaka och kopplingen lämnas tillbaka,
 * `run` körs utan öppen transaktion och transaktionen görs sedan om från början. `run` ska vara idempotent: den kan
 * köras igen om transaktionen görs om. Gäller bara poolens egna transaktioner (`createDatabase`).
 */
export class OutsideTransactionWork extends Error {
  readonly [OUTSIDE_WORK] = true;
  constructor(readonly run: (db: Database) => Promise<void>, message = "Arbete utanför transaktionen") { super(message); }
}

export function isOutsideTransactionWork(error: unknown): error is OutsideTransactionWork {
  return typeof error === "object" && error !== null && (error as { [OUTSIDE_WORK]?: unknown })[OUTSIDE_WORK] === true;
}

/**
 * Översynen 2026-11-02: en transaktion som PostgreSQL avbröt med 40001 eller 40P01 har rullats tillbaka helt och görs om,
 * högst tre försök med växande väntan (med lite slump). Gäller bara poolens egna transaktioner; en savepoint i en
 * transaktion (`tx.transaction`) görs inte om, eftersom hela den yttre transaktionen redan är avbruten.
 * Transaktionens funktion får därför inte ha sidoeffekter utanför databasen; det som måste göras utanför (en uppladdning)
 * begärs med `OutsideTransactionWork`, som körs mellan två försök.
 */
export function retryTopLevelTransactions(db: { transaction: (...args: never[]) => Promise<unknown> }): void {
  const original = db.transaction.bind(db);
  const retrying = async (...args: Parameters<typeof original>) => {
    for (let attempt = 1, rounds = 0; ;) {
      try { return await original(...args); } catch (error) {
        if (isOutsideTransactionWork(error)) {
          if (rounds >= OUTSIDE_WORK_ROUNDS) throw new Error("Transaktionen begärde arbete utanför sig för många gånger", { cause: error });
          rounds += 1;
          await error.run(db as unknown as Database);
          continue;
        }
        if (attempt >= TRANSACTION_ATTEMPTS || !isTransactionConflict(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 40)));
        attempt += 1;
      }
    }
  };
  db.transaction = retrying as unknown as typeof db.transaction;
}

export * as schema from "./schema";
export type { RouteChoicePublished, RouteChoicePublishedCourse } from "./schema/map-content";
export { migrate } from "./migrator";
