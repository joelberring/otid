import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase, migrate, type Pool } from "@o-tid/database";

/**
 * PLAN.md steg 44: migratorn bokför per migration. Varje journalrad som inte finns i `__drizzle_migrations` körs, i
 * journalordning, även när dess `when` är lägre än den senast körda (som en migration från `drizzle-kit generate`).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Steg 44-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const migrations = new URL("../../../database/migrations", import.meta.url).pathname;
type Journal = { entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[] };
const created: { name: string; pool: Pool }[] = [];
const folders: string[] = [];

async function freshDatabase() {
  const name = `otid_steg44_${randomUUID().replaceAll("-", "")}`;
  await admin.pool.query(`CREATE DATABASE "${name}"`);
  const url = new URL(base!);
  url.pathname = `/${name}`;
  const database = createDatabase(url.href);
  created.push({ name, pool: database.pool });
  return database;
}

/** En kopia av migrationerna där journalen ändras av `change`. */
async function folderWith(change: (journal: Journal, folder: string) => Promise<void> | void) {
  const folder = await mkdtemp(join(tmpdir(), "otid-steg44-"));
  folders.push(folder);
  await cp(migrations, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  await change(journal, folder);
  await writeFile(journalPath, JSON.stringify(journal));
  return folder;
}

const journal = async () => JSON.parse(await readFile(join(migrations, "meta/_journal.json"), "utf8")) as Journal;
const bookkeeping = async (pool: Pool) => (await pool.query<{ id: number; tag: string | null; created_at: string }>(
  `SELECT id, tag, created_at::text FROM drizzle.__drizzle_migrations ORDER BY id`)).rows;

afterAll(async () => {
  for (const { name, pool } of created) {
    await pool.end();
    if (!/^otid_steg44_[a-f0-9]{32}$/.test(name)) throw new Error("Ogiltig testdatabas för rensning");
    await admin.pool.query(`DROP DATABASE "${name}"`);
  }
  await admin.pool.end();
  for (const folder of folders) await rm(folder, { recursive: true, force: true });
});

describe("steg 44: migratorn bokför per migration", { timeout: 120_000 }, () => {
  it("kör allt i en ny databas och bara det nya i en uppdaterad", async () => {
    const { db, pool } = await freshDatabase();
    const entries = (await journal()).entries;
    const older = await folderWith((value) => { value.entries = value.entries.slice(0, entries.length - 2); });
    await migrate(db, { migrationsFolder: older });
    const first = await bookkeeping(pool);
    expect(first.map((row) => row.tag)).toEqual(entries.slice(0, entries.length - 2).map((entry) => entry.tag));

    await migrate(db, { migrationsFolder: migrations });
    const second = await bookkeeping(pool);
    expect(second.slice(0, first.length)).toEqual(first);
    expect(second.map((row) => row.tag)).toEqual(entries.map((entry) => entry.tag));
    expect(second.map((row) => row.created_at)).toEqual(entries.map((entry) => String(entry.when)));

    // En andra körning gör ingenting.
    await migrate(db, { migrationsFolder: migrations });
    expect(await bookkeeping(pool)).toEqual(second);
  });

  it("kör en ny migration med lägre `when` än den senast körda", async () => {
    const { db, pool } = await freshDatabase();
    await migrate(db, { migrationsFolder: migrations });
    const generated = await folderWith(async (value, folder) => {
      // Som från drizzle-kit generate: `when` = Date.now(), lägre än de handsatta framtidsdatumen.
      value.entries.push({ idx: value.entries.length, version: "7", when: 1761400000000, tag: "9999_steg44_prov", breakpoints: true });
      await writeFile(join(folder, "9999_steg44_prov.sql"), "CREATE TABLE \"steg44_prov\" (\"id\" integer);");
    });
    await migrate(db, { migrationsFolder: generated });
    expect((await pool.query<{ value: string | null }>("SELECT to_regclass('public.steg44_prov')::text AS value")).rows[0]?.value).toBe("steg44_prov");
    expect((await bookkeeping(pool)).at(-1)).toMatchObject({ tag: "9999_steg44_prov", created_at: "1761400000000" });
    await migrate(db, { migrationsFolder: generated });
    expect((await bookkeeping(pool)).filter((row) => row.tag === "9999_steg44_prov")).toHaveLength(1);
  });

  it("kör inget igen i en databas från före steg 44 (utan tagg, ändrad baslinje)", async () => {
    const { db, pool } = await freshDatabase();
    const before44 = await folderWith((value) => { value.entries = value.entries.filter((entry) => entry.tag < "0019"); });
    await migrate(db, { migrationsFolder: before44 });
    // Som i drift: tabellen har bara hash och created_at, och baslinjens hash är från före steg 28.
    await pool.query(`ALTER TABLE drizzle.__drizzle_migrations DROP COLUMN tag`);
    await pool.query(`UPDATE drizzle.__drizzle_migrations SET hash = 'baslinje-med-postgis' WHERE id = 1`);
    const ids = (await pool.query<{ id: number }>("SELECT id FROM drizzle.__drizzle_migrations ORDER BY id")).rows;

    await migrate(db, { migrationsFolder: migrations });
    const rows = await bookkeeping(pool);
    const entries = (await journal()).entries;
    expect(rows.map((row) => row.tag)).toEqual(entries.map((entry) => entry.tag));
    expect(rows.slice(0, ids.length).map((row) => row.id)).toEqual(ids.map((row) => row.id));
  });
});
