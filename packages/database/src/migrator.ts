import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

export interface MigrateOptions {
  readonly migrationsFolder: string;
}

const ADD_ENUM_VALUE = /^\s*ALTER\s+TYPE\s+[^;]+?\s+ADD\s+VALUE\s+IF\s+NOT\s+EXISTS\s+[^;]+;/gim;
/**
 * Översynen 2026-11-02: ett index på en stor tabell byggs utan att låsa skrivningar (`CREATE INDEX CONCURRENTLY`). Det
 * går inte i en transaktion, så satsen körs före filens transaktion, som enum-värdena. `IF NOT EXISTS` krävs så att en
 * omkörning är ofarlig.
 */
const CONCURRENT_INDEX = /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b[^;]*;/gim;
const CONCURRENT_INDEX_NAME = /CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+ON\b/i;

/** Satserna som körs utanför transaktionen och resten av filen (utan dem). */
export function splitConcurrentIndexes(statement: string): { concurrent: string[]; rest: string } {
  const concurrent = (statement.match(CONCURRENT_INDEX) ?? []).map((match) => match.trim());
  for (const match of concurrent) {
    if (!CONCURRENT_INDEX_NAME.test(match)) throw new Error(`CREATE INDEX CONCURRENTLY kräver IF NOT EXISTS och ett namn: ${match}`);
  }
  return { concurrent, rest: statement.replace(CONCURRENT_INDEX, "") };
}

function onlyComments(statement: string): boolean {
  return statement.replace(/--[^\n]*/g, "").trim() === "";
}

interface JournalEntry { readonly idx: number; readonly tag: string; readonly when: number }

/** Journalens rader i ordning (samma ordning som `readMigrationFiles`). */
export function readMigrationJournal(migrationsFolder: string): JournalEntry[] {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8")) as { entries: JournalEntry[] };
  return journal.entries;
}

type AppliedRow = { id: number; hash: string; created_at: string | number | null; tag: string | null };

/**
 * Drizzle-kompatibel migrering som tål `ALTER TYPE ... ADD VALUE`.
 *
 * Drizzles egen migrator kör alla väntande migrationer i en enda transaktion.
 * PostgreSQL tillåter inte att ett nytt enum-värde används i samma transaktion
 * som det lades till, så en ny databas (och en uppgradering över flera
 * migrationer) kraschar. Här läggs enum-värdena till och committas först,
 * varefter varje migrationsfil körs i en egen transaktion. Bokföringen sker i
 * samma tabell som drizzle använder (`drizzle.__drizzle_migrations`).
 *
 * Vad som redan körts avgörs per migration (steg 44), inte med "allt till och
 * med senaste `when`": varje journalrad som saknas i tabellen körs, i
 * journalordning, även om dess `when` är lägre än en redan körd. En rad räknas
 * som körd om tabellen har dess tagg, eller (rader från före steg 44, utan
 * tagg) dess `when` i `created_at` eller dess hash. Sådana äldre rader får
 * taggen ifylld. Hashen räcker inte ensam: baslinjen ändrades i steg 28.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function migrate(db: NodePgDatabase<any>, options: MigrateOptions): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder: options.migrationsFolder });
  const journal = readMigrationJournal(options.migrationsFolder);
  if (journal.length !== migrations.length) throw new Error("Migrationsjournalen kunde inte läsas");
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )`);
  await db.execute(sql`ALTER TABLE "drizzle"."__drizzle_migrations" ADD COLUMN IF NOT EXISTS "tag" text`);
  const rows = (await db.execute<AppliedRow>(
    sql`select id, hash, created_at, tag from "drizzle"."__drizzle_migrations" order by id`
  )).rows;
  const used = new Set<number>();

  for (const [index, migration] of migrations.entries()) {
    const tag = journal[index]!.tag;
    const applied = rows.find((row) => !used.has(row.id) && row.tag === tag)
      ?? rows.find((row) => !used.has(row.id) && row.tag === null
        && row.created_at !== null && Number(row.created_at) === migration.folderMillis)
      ?? rows.find((row) => !used.has(row.id) && row.tag === null && row.hash === migration.hash);
    if (applied) {
      used.add(applied.id);
      if (applied.tag === null) {
        await db.execute(sql`update "drizzle"."__drizzle_migrations" set "tag" = ${tag} where id = ${applied.id}`);
      }
      continue;
    }
    const split = migration.sql.map(splitConcurrentIndexes);
    const statements = split.map((part) => part.rest);
    for (const statement of statements) {
      for (const match of statement.match(ADD_ENUM_VALUE) ?? []) {
        await db.execute(sql.raw(match));
      }
    }
    for (const statement of split.flatMap((part) => part.concurrent)) {
      // Ett avbrutet bygge lämnar ett ogiltigt index som `IF NOT EXISTS` annars hoppar över: ta bort det först.
      const name = CONCURRENT_INDEX_NAME.exec(statement)![1]!;
      const invalid = await db.execute(sql`select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
        where c.relname = ${name} and not i.indisvalid`);
      if (invalid.rows.length > 0) await db.execute(sql.raw(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`));
      await db.execute(sql.raw(statement));
    }
    await db.transaction(async (tx) => {
      for (const statement of statements) {
        if (!onlyComments(statement)) await tx.execute(sql.raw(statement));
      }
      await tx.execute(sql`insert into "drizzle"."__drizzle_migrations" ("hash", "created_at", "tag")
        values (${migration.hash}, ${migration.folderMillis}, ${tag})`);
    });
  }
}
