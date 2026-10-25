import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

export interface MigrateOptions {
  readonly migrationsFolder: string;
}

const ADD_ENUM_VALUE = /^\s*ALTER\s+TYPE\s+[^;]+?\s+ADD\s+VALUE\s+IF\s+NOT\s+EXISTS\s+[^;]+;/gim;

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
    const statements = migration.sql;
    for (const statement of statements) {
      for (const match of statement.match(ADD_ENUM_VALUE) ?? []) {
        await db.execute(sql.raw(match));
      }
    }
    await db.transaction(async (tx) => {
      for (const statement of statements) {
        await tx.execute(sql.raw(statement));
      }
      await tx.execute(sql`insert into "drizzle"."__drizzle_migrations" ("hash", "created_at", "tag")
        values (${migration.hash}, ${migration.folderMillis}, ${tag})`);
    });
  }
}
