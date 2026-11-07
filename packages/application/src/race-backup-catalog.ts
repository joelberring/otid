import { sql } from "drizzle-orm";
import { ANY_UUID_SOURCE, type BackupColumnType } from "@o-tid/contracts";
import type { DbExecutor } from "./snapshot";

/**
 * Kolumnerna i säkerhetskopians tabeller enligt databasens katalog (ADR-0187). Exporten skriver dem som de är, och
 * återställningen godtar bara kolumner som finns här med rätt typ. En ny kolumn kommer därför med utan kodändring.
 */
export interface BackupColumn { name: string; type: BackupColumnType; nullable: boolean }
export interface BackupTableCatalog { columns: BackupColumn[]; primaryKey: string[] }

const TYPES: Readonly<Record<string, BackupColumnType>> = {
  uuid: "uuid", text: "text", integer: "integer", smallint: "smallint", bigint: "bigint", "double precision": "double precision",
  boolean: "boolean", date: "date", "timestamp with time zone": "timestamp with time zone", jsonb: "jsonb", bytea: "bytea"
};

export const quoteIdentifier = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("Ogiltigt namn i säkerhetskopian");
  return `"${name}"`;
};

export async function loadBackupCatalog(tx: DbExecutor, tables: readonly string[]): Promise<Map<string, BackupTableCatalog>> {
  const columns = await tx.execute<{ table_name: string; column_name: string; data_type: string; udt_name: string; is_nullable: string;
    is_generated: string; identity_generation: string | null }>(sql`
    select table_name, column_name, data_type, udt_name, is_nullable, is_generated, identity_generation
    from information_schema.columns
    where table_schema = current_schema() and table_name = any(${`{${tables.join(",")}}`}::text[])
    order by table_name, ordinal_position`);
  const keys = await tx.execute<{ table_name: string; column_name: string }>(sql`
    select c.relname as table_name, a.attname as column_name
    from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
    join unnest(i.indkey) with ordinality k(attnum, position) on true
    join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
    where i.indisprimary and n.nspname = current_schema() and c.relname = any(${`{${tables.join(",")}}`}::text[])
    order by c.relname, k.position`);
  const catalog = new Map<string, BackupTableCatalog>(tables.map(table => [table, { columns: [], primaryKey: [] }]));
  for (const row of columns.rows) {
    // Genererade kolumner och identitetskolumner skrivs aldrig.
    if (row.is_generated === "ALWAYS" || row.identity_generation !== null) continue;
    const type = row.data_type === "USER-DEFINED" ? "enum" : row.data_type === "ARRAY" && row.udt_name === "_text" ? "text[]"
      : TYPES[row.data_type];
    if (!type) throw new Error(`Säkerhetskopian känner inte till typen ${row.data_type} (${row.table_name}.${row.column_name})`);
    catalog.get(row.table_name)!.columns.push({ name: row.column_name, type, nullable: row.is_nullable === "YES" });
  }
  for (const row of keys.rows) catalog.get(row.table_name)!.primaryKey.push(row.column_name);
  for (const [table, entry] of catalog) if (entry.columns.length === 0) throw new Error(`Tabellen ${table} finns inte`);
  return catalog;
}

/** Ett id i text: gemener, som PostgreSQL skriver dem. */
export const UUID_IN_TEXT = new RegExp(ANY_UUID_SOURCE, "g");

/** Byter varje id i `map` mot sitt nya värde, också i nycklar och inuti text (t.ex. IOF XML och kanonisk JSON). */
export function remapDeep(value: unknown, map: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return value.replace(UUID_IN_TEXT, id => map.get(id) ?? id);
  if (Array.isArray(value)) return value.map(item => remapDeep(item, map));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [remapDeep(key, map) as string, remapDeep(item, map)]));
  }
  return value;
}
