import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase, migrate, type Pool } from "@o-tid/database";
import { ingest, run, seedRace } from "./steg-25-fixtures";

/**
 * PLAN.md steg 28: vanlig PostgreSQL (postgres:17) i stället för PostGIS. En ny databas skapas utan tillägget, och en
 * databas från före steg 28 (baslinjen med PostGIS, riktiga anmälningar) uppgraderas med `pnpm db:migrate` utan att
 * något går förlorat: redan körda migrationer körs inte om och 0007 tar bort tillägget.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Steg 28-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const migrations = new URL("../../../database/migrations", import.meta.url).pathname;
/** Journalens tidpunkter i ordning: alla migrationer, även de efter steg 28, ska vara körda en gång. */
async function journalTimes(): Promise<string[]> {
  const journal = JSON.parse(await readFile(join(migrations, "meta/_journal.json"), "utf8")) as { entries: { when: number }[] };
  return journal.entries.map((entry) => String(entry.when));
}
const created: { name: string; pool: Pool }[] = [];

async function freshDatabase() {
  const name = `otid_steg28_${randomUUID().replaceAll("-", "")}`;
  await admin.pool.query(`CREATE DATABASE "${name}"`);
  const url = new URL(base!);
  url.pathname = `/${name}`;
  const database = createDatabase(url.href);
  created.push({ name, pool: database.pool });
  return database;
}

/** Migrationerna som fanns före steg 28 (0000–0006), i en egen katalog. */
async function migrationsBeforeStep28() {
  const folder = await mkdtemp(join(tmpdir(), "otid-steg28-"));
  await cp(migrations, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((entry) => entry.tag < "0007");
  await writeFile(journalPath, JSON.stringify(journal));
  return folder;
}

const scalar = async (pool: Pool, query: string) => (await pool.query<{ value: string | null }>(query)).rows[0]!.value;
const extensionTypedColumns = (pool: Pool) => scalar(pool, `SELECT count(*)::text AS value FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid JOIN pg_depend d ON d.classid = 'pg_type'::regclass AND d.objid = a.atttypid AND d.deptype = 'e'
  WHERE c.relnamespace = 'public'::regnamespace AND a.attnum > 0 AND NOT a.attisdropped`);
const fingerprint = (pool: Pool) => scalar(pool, `SELECT concat_ws('|',
  (SELECT count(*) FROM entry), (SELECT count(*) FROM card_readout), (SELECT count(*) FROM result_revision),
  (SELECT md5(string_agg(e::text, ',' ORDER BY e.id)) FROM entry e),
  (SELECT md5(string_agg(r::text, ',' ORDER BY r.id)) FROM card_readout r),
  -- Steg 31 (0009) tar bort den oanvända kolumnen control_neutralization_id; övriga värden ska vara oförändrade.
  (SELECT md5(string_agg((to_jsonb(r) - 'control_neutralization_id')::text, ',' ORDER BY r.id)) FROM result_revision r)) AS value`);

afterAll(async () => {
  for (const { name, pool } of created) {
    await pool.end();
    if (!/^otid_steg28_[a-f0-9]{32}$/.test(name)) throw new Error("Ogiltig testdatabas för rensning");
    await admin.pool.query(`DROP DATABASE "${name}"`);
  }
  await admin.pool.end();
});

describe("steg 28: PostgreSQL utan PostGIS", () => {
  it("skapar en ny databas utan PostGIS och utan kolumner av tilläggstyper", async () => {
    const { db, pool } = await freshDatabase();
    await migrate(db, { migrationsFolder: migrations });
    expect(await scalar(pool, "SELECT string_agg(extname, ',' ORDER BY extname) AS value FROM pg_extension")).toBe("plpgsql");
    expect(await extensionTypedColumns(pool)).toBe("0");
    expect(await scalar(pool, `SELECT count(*)::text AS value FROM drizzle.__drizzle_migrations`)).toBe(String((await journalTimes()).length));
  });

  it("uppgraderar en databas från före steg 28 med PostGIS och anmälda utan att något försvinner", async () => {
    const { db, pool } = await freshDatabase();
    // Den gamla baslinjen skapade PostGIS. Finns tillägget på servern (lokalt) skapas det här likadant; på postgres:17
    // (CI) finns det inte, och då provas resten: redan körda migrationer körs inte om och 0007 körs.
    const postgisAvailable = await scalar(pool, "SELECT count(*)::text AS value FROM pg_available_extensions WHERE name = 'postgis'");
    if (postgisAvailable === "1") await pool.query("CREATE EXTENSION postgis WITH SCHEMA public");
    const before28 = await migrationsBeforeStep28();
    try {
      await migrate(db, { migrationsFolder: before28 });
    } finally {
      await rm(before28, { recursive: true, force: true });
    }
    // Dagens avläsningskod läser tävlingens rättningar (steg 31, 0009); en tom tabell räcker för den gamla databasen.
    await pool.query(`CREATE TABLE race_station_correction (id uuid, race_id uuid, kind text, station text, control_code integer,
      offset_ms integer, reason text, actor_account_id uuid, created_at timestamptz, removed_at timestamptz, removed_by_account_id uuid)`);
    // …och avläsningens check och clear (0009 lägger till kolumnerna om de saknas).
    await pool.query("ALTER TABLE card_readout ADD COLUMN check_punched_at timestamptz, ADD COLUMN clear_punched_at timestamptz");
    const { ids, cards } = await seedRace(db, pool);
    await ingest(db, ids.race, [run(cards.ada, "10:02:00", 30), run(cards.bo, "10:05:00", 41)]);
    await pool.query("DROP TABLE race_station_correction");
    const data = await fingerprint(pool);
    expect(data).toMatch(/^5\|2\|[1-9]\d*\|/);

    // Databasen skapades med en äldre glibc (postgis/postgis:17-3.5 = Debian bullseye): 0007 bygger om och uppdaterar.
    const superuser = await scalar(pool, "SELECT rolsuper::text AS value FROM pg_roles WHERE rolname = current_user");
    const actual = await scalar(pool, "SELECT pg_database_collation_actual_version(oid) AS value FROM pg_database WHERE datname = current_database()");
    const simulateOldGlibc = superuser === "true" && actual !== null;
    if (simulateOldGlibc) await pool.query("UPDATE pg_database SET datcollversion = '2.31' WHERE datname = current_database()");

    await migrate(db, { migrationsFolder: migrations });
    expect(await fingerprint(pool)).toBe(data);
    expect(await scalar(pool, "SELECT count(*)::text AS value FROM pg_extension WHERE extname = 'postgis'")).toBe("0");
    expect(await scalar(pool, "SELECT to_regclass('public.spatial_ref_sys')::text AS value")).toBeNull();
    expect(await scalar(pool, `SELECT string_agg(created_at::text, ',' ORDER BY id) AS value FROM drizzle.__drizzle_migrations`))
      .toBe((await journalTimes()).join(","));
    if (simulateOldGlibc) {
      expect(await scalar(pool, "SELECT datcollversion AS value FROM pg_database WHERE datname = current_database()")).toBe(actual);
    }

    // En andra körning gör ingenting.
    await migrate(db, { migrationsFolder: migrations });
    expect(await scalar(pool, `SELECT count(*)::text AS value FROM drizzle.__drizzle_migrations`)).toBe(String((await journalTimes()).length));
    expect(await fingerprint(pool)).toBe(data);
  });
});
