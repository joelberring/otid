import { randomUUID } from "node:crypto";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate, schema } from "@o-tid/database";

/**
 * Städrundan 2026-11-07 (C5): Drizzle-schemat i `packages/database/src/schema` speglar migrationerna, som är auktoritativa.
 * Efter att alla migrationer körts mot en tom databas jämförs varje exporterad tabell med `information_schema.columns`:
 * kolumnernas namn, om de får vara NULL och typen i grova drag (utan längd och precision). Tabeller och kolumner som medvetet
 * bara finns i SQL står i undantagslistorna nedan, med skälet.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_schemadrift_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 120_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_schemadrift_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

/** Tabeller som bara finns i SQL (läses och skrivs med rå SQL eller bara av databasen själv). */
const SQL_ONLY_TABLES: Record<string, string> = {
  // Inga i dag: varje tabell i public har en Drizzle-tabell. Lägg till `tabell: "skäl"` om en tabell medvetet bara finns i SQL.
};

/** Kolumner som bara finns i SQL, som `tabell.kolumn`. */
const SQL_ONLY_COLUMNS: Record<string, string> = {
  // Träningsgruppens kartbibliotek (ADR-0182, migration 0035): bilderna, filerna och georefereringen kopieras och läses med rå SQL
  // i application (se kommentaren överst i schema/groups.ts); nya rader har innehållet i map_content (ADR-0189).
  "training_group_map.media_type": "kartbiblioteket, rå SQL",
  "training_group_map.image": "kartbiblioteket, rå SQL (bytea)",
  "training_group_map.tie_points": "kartbiblioteket, rå SQL",
  "training_group_map_source.version": "kartbiblioteket, rå SQL",
  "training_group_map_source.file": "kartbiblioteket, rå SQL (bytea)",
  "training_group_map_source.sha256": "kartbiblioteket, rå SQL",
  "training_group_map_source.byte_length": "kartbiblioteket, rå SQL",
  "training_group_map_source.bounds": "kartbiblioteket, rå SQL",
  "training_group_map_source.georeference": "kartbiblioteket, rå SQL",
  "training_group_map_source.render": "kartbiblioteket, rå SQL",
  "training_group_map_source.summary": "kartbiblioteket, rå SQL",
  "training_group_map_course_setting.document": "kartbiblioteket, rå SQL",
  "training_group_map_course_setting.original_ppen": "kartbiblioteket, rå SQL (bytea)"
};

/** Typen i grova drag: alias till samma namn, utan längd och precision; enum som `enum:<namn>`, array som `<typ>[]`. */
function coarseDrizzle(sqlType: string, enumName: string | undefined): string {
  if (enumName) return `enum:${enumName}`;
  const array = sqlType.endsWith("[]");
  const plain = sqlType.replace(/\[\]$/, "").replace(/\(.*\)/, "").trim().toLowerCase();
  const alias: Record<string, string> = {
    varchar: "character varying", char: "character", timestamp: "timestamp without time zone",
    timestamptz: "timestamp with time zone", "timestamp with time zone": "timestamp with time zone", time: "time without time zone",
    serial: "integer", bigserial: "bigint", smallserial: "smallint", int: "integer", int4: "integer", int8: "bigint", int2: "smallint",
    float8: "double precision", float4: "real", decimal: "numeric", bool: "boolean"
  };
  const name = alias[plain] ?? plain;
  return array ? `${name}[]` : name;
}

function coarseDatabase(column: { data_type: string; udt_name: string; enum: boolean }): string {
  if (column.data_type === "ARRAY") {
    const element = column.udt_name.replace(/^_/, "");
    const alias: Record<string, string> = { int4: "integer", int8: "bigint", int2: "smallint", bool: "boolean", float8: "double precision",
      float4: "real", varchar: "character varying", timestamptz: "timestamp with time zone" };
    return `${alias[element] ?? element}[]`;
  }
  if (column.data_type === "USER-DEFINED") return column.enum ? `enum:${column.udt_name}` : column.udt_name;
  return column.data_type;
}

interface Described { notNull: boolean; type: string }

function drizzleTables(): Map<string, Map<string, Described>> {
  const tables = new Map<string, Map<string, Described>>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    if (config.schema && config.schema !== "public") continue;
    const primary = new Set(config.primaryKeys.flatMap(key => key.columns.map(column => column.name)));
    const columns = new Map<string, Described>();
    for (const column of config.columns) {
      const enumName = "enum" in column && column.enum && "enumName" in (column.enum as object)
        ? String((column.enum as { enumName: unknown }).enumName) : undefined;
      columns.set(column.name, { notNull: column.notNull || column.primary || primary.has(column.name),
        type: coarseDrizzle(column.getSQLType(), enumName) });
    }
    tables.set(config.name, columns);
  }
  return tables;
}

async function databaseTables(): Promise<Map<string, Map<string, Described>>> {
  const rows = (await pool.query<{ table_name: string; column_name: string; is_nullable: string; data_type: string; udt_name: string;
    is_enum: boolean }>(`select c.table_name, c.column_name, c.is_nullable, c.data_type, c.udt_name,
      exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where t.typname = c.udt_name and n.nspname = c.udt_schema and t.typtype = 'e') as is_enum
    from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE' order by c.table_name, c.ordinal_position`)).rows;
  const tables = new Map<string, Map<string, Described>>();
  for (const row of rows) {
    const columns = tables.get(row.table_name) ?? new Map<string, Described>();
    columns.set(row.column_name, { notNull: row.is_nullable === "NO",
      type: coarseDatabase({ data_type: row.data_type, udt_name: row.udt_name, enum: row.is_enum }) });
    tables.set(row.table_name, columns);
  }
  return tables;
}

describe("C5: Drizzle-schemat och databasen efter alla migrationer", { timeout: 120_000 }, () => {
  it("har samma tabeller, kolumner, NULL-regler och typer i grova drag", async () => {
    const drizzle = drizzleTables();
    const database = await databaseTables();
    const problems: string[] = [];
    for (const name of drizzle.keys()) {
      if (!database.has(name)) problems.push(`${name}: finns i Drizzle men inte i databasen`);
      if (name in SQL_ONLY_TABLES) problems.push(`${name}: står som bara i SQL men finns i Drizzle`);
    }
    for (const name of database.keys()) {
      if (!drizzle.has(name) && !(name in SQL_ONLY_TABLES)) problems.push(`${name}: finns i databasen men inte i Drizzle`);
    }
    for (const name of Object.keys(SQL_ONLY_TABLES)) if (!database.has(name)) problems.push(`${name}: undantaget finns inte i databasen`);
    for (const [table, columns] of drizzle) {
      const actual = database.get(table);
      if (!actual) continue;
      for (const [column, expected] of columns) {
        const found = actual.get(column);
        if (!found) { problems.push(`${table}.${column}: finns i Drizzle men inte i databasen`); continue; }
        if (found.notNull !== expected.notNull) {
          problems.push(`${table}.${column}: ${expected.notNull ? "NOT NULL" : "nullbar"} i Drizzle, ${found.notNull ? "NOT NULL" : "nullbar"} i databasen`);
        }
        if (found.type !== expected.type) problems.push(`${table}.${column}: ${expected.type} i Drizzle, ${found.type} i databasen`);
      }
      for (const column of actual.keys()) {
        if (!columns.has(column) && !(`${table}.${column}` in SQL_ONLY_COLUMNS)) problems.push(`${table}.${column}: finns i databasen men inte i Drizzle`);
      }
    }
    for (const key of Object.keys(SQL_ONLY_COLUMNS)) {
      const [table, column] = key.split(".") as [string, string];
      if (!database.get(table)?.has(column)) problems.push(`${key}: undantaget finns inte i databasen`);
      if (drizzle.get(table)?.has(column)) problems.push(`${key}: står som bara i SQL men finns i Drizzle`);
    }
    expect(problems).toEqual([]);
  });
});
