import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { purgeRows, type PurgeRoot } from "../../src/purge";
import { db, useRaceDatabase } from "./race-fixtures";

/**
 * Granskningen (runda 2, fynd 6): ett markerat barn med ON DELETE SET NULL mot en förälder som också tas bort ska tas bort före
 * föräldern. Annars uppdaterar databasen barnet (ny ctid) och borttagningen missar raden.
 */
useRaceDatabase();

describe("purgeRows och SET NULL-nycklar", () => {
  it("tar bort ett barn med SET NULL före dess förälder när båda hör till samma rot", async () => {
    const schemaName = `purge_test_${randomUUID().slice(0, 8)}`;
    const root = randomUUID(), parent = randomUUID(), child = randomUUID();
    await db.transaction(async tx => {
      await tx.execute(sql.raw(`create schema ${schemaName}`));
      await tx.execute(sql.raw(`set local search_path to ${schemaName}`));
      await tx.execute(sql.raw(`
        create table a_root (id uuid primary key);
        create table b_parent (id uuid primary key, root_id uuid not null references a_root(id) on delete cascade);
        create table c_child (id uuid primary key, root_id uuid not null references a_root(id) on delete cascade,
          parent_id uuid references b_parent(id) on delete set null);
        insert into a_root values ('${root}'); insert into b_parent values ('${parent}', '${root}');
        insert into c_child values ('${child}', '${root}', '${parent}')`));
      const deleted = await purgeRows(tx, "a_root" as PurgeRoot, [root]);
      expect(deleted.get("c_child")).toBe(1);
      expect(deleted.get("b_parent")).toBe(1);
      const left = await tx.execute<{ count: string }>(sql.raw("select count(*)::text as count from c_child"));
      expect(left.rows[0]?.count).toBe("0");
      await tx.execute(sql.raw(`drop schema ${schemaName} cascade`));
    });
  });
});
