import { createDatabase } from "@o-tid/database";

const globalDatabase = globalThis as typeof globalThis & {
  oTidDatabase?: ReturnType<typeof createDatabase>;
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

export const database = globalDatabase.oTidDatabase ?? createDatabase(databaseUrl());
if (process.env.NODE_ENV !== "production") globalDatabase.oTidDatabase = database;

export const db = database.db;
export const pool = database.pool;
