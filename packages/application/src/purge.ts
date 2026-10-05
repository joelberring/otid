import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "./snapshot";

/**
 * Uttrycklig borttagning (ADR-0172 beslut 2): en tävling (event med lopp) eller ett konto tas bort med
 * allt som hänger ihop med det, också råa avläsningar och journaler som annars aldrig ändras.
 *
 * Vilka rader som hör till följer databasens främmande nycklar: en rad tas bort om den pekar på en rad
 * som tas bort. Raderna samlas först i temporära tabeller och tas sedan bort barn före förälder.
 * Uppskjutna nycklar (DEFERRABLE) kontrolleras vid commit och styr inte ordningen. Nya tabeller med
 * nycklar kommer därför med automatiskt. Skyddstriggrarna släpper igenom DELETE bara när
 * `otid.purge` är satt i samma transaktion (migration 0099).
 */
export type PurgeRoot = "event" | "user_account";

interface ForeignKey { child: string; parent: string; childColumns: string[]; parentColumns: string[]; deferrable: boolean }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const quote = (identifier: string) => `"${identifier.replaceAll("\"", "\"\"")}"`;

async function foreignKeys(tx: DbExecutor): Promise<ForeignKey[]> {
  const result = await tx.execute<{ child: string; parent: string; child_columns: string[]; parent_columns: string[]; deferrable: boolean }>(sql`
    select child.relname as child, parent.relname as parent, c.condeferrable as deferrable,
      array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, position)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.position) as child_columns,
      array(select a.attname::text from unnest(c.confkey) with ordinality k(attnum, position)
        join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum order by k.position) as parent_columns
    from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_class parent on parent.oid = c.confrelid
    join pg_namespace n on n.oid = child.relnamespace
    where c.contype = 'f' and n.nspname = current_schema()
    order by child.relname, c.conname`);
  return result.rows.map((row) => ({ child: row.child, parent: row.parent, childColumns: row.child_columns,
    parentColumns: row.parent_columns, deferrable: row.deferrable }));
}

/**
 * Tar bort raderna med id `ids` i `root` och allt som pekar på dem. Körs i anroparens transaktion och
 * returnerar antal borttagna rader per tabell.
 */
export async function purgeRows(tx: DbExecutor, root: PurgeRoot, ids: readonly string[]): Promise<Map<string, number>> {
  for (const id of ids) if (!UUID_PATTERN.test(id)) throw new Error("Ogiltigt id för borttagning");
  const deleted = new Map<string, number>();
  if (ids.length === 0) return deleted;
  await tx.execute(sql`select set_config('otid.purge', 'on', true)`);
  const keys = await foreignKeys(tx);
  const byParent = new Map<string, ForeignKey[]>();
  const keyColumns = new Map<string, Set<string>>();
  for (const key of keys) {
    byParent.set(key.parent, [...(byParent.get(key.parent) ?? []), key]);
    const columns = keyColumns.get(key.parent) ?? new Set<string>();
    for (const column of key.parentColumns) columns.add(column);
    keyColumns.set(key.parent, columns);
  }

  // Varje tabell som berörs får en temporär tabell med radens ctid och de kolumner som barnen pekar på.
  const marked = new Map<string, string>();
  const prefix = `otid_purge_${randomBytes(4).toString("hex")}`;
  const markTable = async (table: string): Promise<string> => {
    const existing = marked.get(table);
    if (existing) return existing;
    const name = `${prefix}_${marked.size}`;
    const columns = [...(keyColumns.get(table) ?? [])].map(quote);
    await tx.execute(sql.raw(`create temp table ${name} on commit drop as
      select t.ctid as purge_ctid${columns.map((column) => `, t.${column}`).join("")} from ${quote(table)} t where false`));
    marked.set(table, name);
    return name;
  };
  const columnsOf = (table: string) => [...(keyColumns.get(table) ?? [])].map((column) => `, t.${quote(column)}`).join("");

  const rootMark = await markTable(root);
  const idList = ids.map((id) => `'${id}'::uuid`).join(", ");
  await tx.execute(sql.raw(`insert into ${rootMark} select t.ctid${columnsOf(root)} from ${quote(root)} t
    where t.id in (${idList}) for update of t`));

  // Sprid markeringen längs nycklarna tills inget nytt tillkommer (cykler via uppskjutna nycklar ingår).
  const queue: string[] = [root];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    const parentMark = marked.get(parent)!;
    for (const key of byParent.get(parent) ?? []) {
      const childMark = await markTable(key.child);
      const childColumns = key.childColumns.map((column) => `t.${quote(column)}`).join(", ");
      const parentColumns = key.parentColumns.map((column) => `p.${quote(column)}`).join(", ");
      const result = await tx.execute(sql.raw(`insert into ${childMark}
        select t.ctid${columnsOf(key.child)} from ${quote(key.child)} t
        where (${childColumns}) in (select ${parentColumns} from ${parentMark} p)
          and not exists (select 1 from ${childMark} x where x.purge_ctid = t.ctid)
        for update of t`));
      if ((result.rowCount ?? 0) > 0 && !queue.includes(key.child)) queue.push(key.child);
    }
  }

  // Barn före förälder enligt nycklar som kontrolleras direkt.
  const remaining = new Set<string>();
  for (const [table, mark] of marked) {
    const count = await tx.execute<{ count: string }>(sql.raw(`select count(*)::text as count from ${mark}`));
    if (Number(count.rows[0]?.count ?? 0) > 0) remaining.add(table);
  }
  while (remaining.size > 0) {
    const ready = [...remaining].filter((table) => !keys.some((key) => key.parent === table && key.child !== table &&
      !key.deferrable && remaining.has(key.child)));
    if (ready.length === 0) throw new Error(`Borttagningen har en cykel av omedelbara nycklar: ${[...remaining].join(", ")}`);
    for (const table of ready.sort()) {
      const result = await tx.execute(sql.raw(`delete from ${quote(table)} where ctid in (select purge_ctid from ${marked.get(table)})`));
      deleted.set(table, result.rowCount ?? 0);
      remaining.delete(table);
    }
  }
  for (const mark of marked.values()) await tx.execute(sql.raw(`drop table ${mark}`));
  return deleted;
}
