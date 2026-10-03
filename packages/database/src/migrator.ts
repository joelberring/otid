import { readMigrationFiles } from "drizzle-orm/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

export interface MigrateOptions {
  readonly migrationsFolder: string;
}

const ADD_ENUM_VALUE = /^\s*ALTER\s+TYPE\s+[^;]+?\s+ADD\s+VALUE\s+IF\s+NOT\s+EXISTS\s+[^;]+;/gim;

/**
 * Drizzle-kompatibel migrering som tål `ALTER TYPE ... ADD VALUE`.
 *
 * Drizzles egen migrator kör alla väntande migrationer i en enda transaktion.
 * PostgreSQL tillåter inte att ett nytt enum-värde används i samma transaktion
 * som det lades till, så en ny databas (och en uppgradering över flera
 * migrationer) kraschar. Här läggs enum-värdena till och committas först,
 * varefter varje migrationsfil körs i en egen transaktion. Bokföringen sker i
 * samma tabell som drizzle använder (`drizzle.__drizzle_migrations`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function migrate(db: NodePgDatabase<any>, options: MigrateOptions): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder: options.migrationsFolder });
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )`);
  const last = await db.execute<{ created_at: string | number | null }>(
    sql`select created_at from "drizzle"."__drizzle_migrations" order by created_at desc limit 1`
  );
  const lastCreatedAt = last.rows[0]?.created_at == null ? undefined : Number(last.rows[0].created_at);

  for (const migration of migrations) {
    if (lastCreatedAt !== undefined && lastCreatedAt >= migration.folderMillis) continue;
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
      await tx.execute(
        sql`insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values (${migration.hash}, ${migration.folderMillis})`
      );
    });
  }
}
