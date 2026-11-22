import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";

/** Granskningen 2.9: två containrar som migrerar en tom databas samtidigt kör varje migration en gång. */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_audit29_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const first = createDatabase(url.href), second = createDatabase(url.href);
const migrationsFolder = new URL("../../../database/migrations", import.meta.url).pathname;

beforeAll(async () => { await admin.pool.query(`CREATE DATABASE "${databaseName}"`); }, 60_000);
afterAll(async () => {
  await first.pool.end();
  await second.pool.end();
  if (!/^otid_audit29_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

describe("granskning 2.9: migrator med samtidiga starter", () => {
  it("kör varje migration exakt en gång", async () => {
    await Promise.all([migrate(first.db, { migrationsFolder }), migrate(second.db, { migrationsFolder })]);
    const rows = (await first.pool.query<{ tag: string }>(`SELECT tag FROM drizzle.__drizzle_migrations`)).rows;
    expect(new Set(rows.map((row) => row.tag)).size).toBe(rows.length);
    expect(rows.length).toBeGreaterThan(100);
  }, 280_000);
});
