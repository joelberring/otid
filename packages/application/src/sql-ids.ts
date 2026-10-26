import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { UUID_PATTERN } from "./serialization";

/**
 * Steg 51 (lasttest): `kolumn = any($1::uuid[])` med en enda parameter. Drizzles `inArray` bygger en parameter per
 * värde, vilket för 3 000–7 500 deltagare tar 30–60 ms per fråga bara att bygga (mätt i docs/lasttest.md). Samma urval.
 */
export function inUuids(column: AnyColumn, ids: readonly string[]): SQL {
  for (const id of ids) if (!UUID_PATTERN.test(id)) throw new Error("Ogiltigt id i urvalet");
  return sql`${column} = any(${`{${ids.join(",")}}`}::uuid[])`;
}
