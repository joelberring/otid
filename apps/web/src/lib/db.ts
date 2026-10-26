import { createDatabase } from "@o-tid/database";
import { environmentNumber, instanceRole } from "./instance-role";

const globalDatabase = globalThis as typeof globalThis & {
  oTidDatabase?: ReturnType<typeof createDatabase>;
  oTidPublicDatabase?: ReturnType<typeof createDatabase>;
};

function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value && process.env.npm_lifecycle_event === "build") {
    // Poolen ansluter inte förrän en query körs; under Nexts statiska sidinsamling
    // ska import av route-moduler därför inte kräva en levande databas.
    return "postgresql://build:build@127.0.0.1:1/build";
  }
  if (!value) throw new Error("DATABASE_URL måste anges vid körning");
  return value;
}

/**
 * Steg 54 (ADR-0177): separata pooler. Tävlingens pool (arbetsytan, avläsningen, funktionärerna) har inga tidsgränser
 * och tar högst `OTID_DB_POOL_MAX` (10) anslutningar. Publikens pool (de publika listorna och, i `web-public`, allt)
 * tar högst `OTID_PUBLIC_DB_POOL_MAX` (8 i web-public, annars 3) och avbryter frågor efter
 * `OTID_PUBLIC_STATEMENT_TIMEOUT_MS` (5 s) och väntan på lås efter 2 s. Publiken kan därför aldrig ta tävlingens
 * anslutningar, och en seg publik fråga håller inte databasen. Summan i drift (10 + 3 + 8 + radio och backup) ligger
 * långt under PostgreSQL:s 100 anslutningar.
 */
const role = instanceRole();
function publicPool() {
  return createDatabase(databaseUrl(), {
    max: environmentNumber(process.env, "OTID_PUBLIC_DB_POOL_MAX", role === "public" ? 8 : 3),
    statementTimeoutMs: environmentNumber(process.env, "OTID_PUBLIC_STATEMENT_TIMEOUT_MS", 5_000),
    lockTimeoutMs: 2_000, idleInTransactionTimeoutMs: 10_000, applicationName: "otid-public" });
}

export const publicDatabase = globalDatabase.oTidPublicDatabase ?? publicPool();
/** I `web-public` är publikens pool den enda; annars tävlingens. */
export const database = role === "public" ? publicDatabase : globalDatabase.oTidDatabase ?? createDatabase(databaseUrl(), {
  max: environmentNumber(process.env, "OTID_DB_POOL_MAX", 10), applicationName: role === "competition" ? "otid-web" : "otid" });
if (process.env.NODE_ENV !== "production") {
  globalDatabase.oTidDatabase = database;
  globalDatabase.oTidPublicDatabase = publicDatabase;
}

export const db = database.db;
export const pool = database.pool;
/** De publika listornas uträkning (steg 54): egen pool med tidsgräns. */
export const publicDb = publicDatabase.db;
export const publicPoolOfDatabase = publicDatabase.pool;
