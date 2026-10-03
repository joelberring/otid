import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq, getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { schema, type Database } from "@o-tid/database";
import { importIofXml } from "./import-iof";
import { issuePairingAdminAccessCredential } from "./pairing-admin";
import { validateDemoTarget } from "./demo-target-policy";

export class DemoProvisioningError extends Error {
  constructor() { super("Demoprovisionering kunde inte bekräftas. Kontrollera privat output och måldatabas innan nytt försök."); }
}

export type DemoInstallation = {
  formatVersion: 1;
  eventId: string;
  raceId: string;
  expiresAt: string;
  credentials: Awaited<ReturnType<typeof issuePairingAdminAccessCredential>>[];
};

/** Trusted local tool only. No web route; never interprets this as production authority. */
export async function provisionSyntheticDemo(
  db: Database,
  input: Parameters<typeof validateDemoTarget>[0],
  persistPrivateOutput: (installation: DemoInstallation) => Promise<void>
): Promise<Omit<DemoInstallation, "credentials">> {
  const target = validateDemoTarget(input);
  try {
    const courseXml = await readFile(new URL("../../../fixtures/iof/course-data.xml", import.meta.url), "utf8");
    const entryXml = await readFile(new URL("../../../fixtures/iof/demo-entry-list.xml", import.meta.url), "utf8");
    const startListXml = await readFile(new URL("../../../fixtures/iof/demo-start-list.xml", import.meta.url), "utf8");
    return await db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      const actual = await tx.execute<{ database_name: string }>(sql`SELECT current_database() AS database_name`);
      if (actual.rows[0]?.database_name !== target.databaseName) throw new DemoProvisioningError();
      const tableNames = [...new Set(Object.values(schema).filter(value => is(value, PgTable)).map(table => getTableName(table)))].sort();
      if (!tableNames.length) throw new DemoProvisioningError();
      // Stable whole-database application locks make the empty check and all writes indivisible.
      for (const table of tableNames) await tx.execute(sql`LOCK TABLE ${sql.identifier(table)} IN ACCESS EXCLUSIVE MODE`);
      for (const table of tableNames) {
        const contents = await tx.execute(sql`SELECT 1 FROM ${sql.identifier(table)} LIMIT 1`);
        if (contents.rows.length) throw new DemoProvisioningError();
      }
      const now = new Date(), expiresAt = new Date(now.getTime() + 3_600_000);
      const eventId = randomUUID(), raceId = randomUUID(), date = "2026-09-19";
      await tx.insert(schema.events).values({ id: eventId, name: "O-Tid syntetisk demonstration", startsOn: date, timeZone: "Europe/Stockholm" });
      await tx.insert(schema.races).values({ id: raceId, eventId, name: "Testlopp – ingen riktig tävling", raceDate: date });
      await importIofXml(tx, raceId, courseXml);
      await importIofXml(tx, raceId, entryXml);
      await importIofXml(tx, raceId, startListXml);
      const [fixedClass] = await tx.update(schema.classes).set({ maxEntries: 2 }).where(and(
        eq(schema.classes.raceId, raceId), eq(schema.classes.externalSource, "iof"), eq(schema.classes.externalId, "class-d21")
      )).returning({ id: schema.classes.id });
      if (!fixedClass) throw new DemoProvisioningError();
      const credentials: DemoInstallation["credentials"] = [];
      for (const capability of ["VIEW_RACE_OVERVIEW", "START_CHECKIN", "FINISH_FOREST_WATCH", "MANAGE_RACE"] as const) {
        credentials.push(await issuePairingAdminAccessCredential(tx, {
          raceId, capability, label: "Syntetisk demonstration", expiresAt
        }, { now }));
      }
      const summary = { formatVersion: 1 as const, eventId, raceId, expiresAt: expiresAt.toISOString() };
      // Filesystem failure still rolls back all DB writes. A later COMMIT error can be uncertain.
      await persistPrivateOutput({ ...summary, credentials });
      return summary;
    });
  } catch {
    // Neither database details, connection strings nor a private sink's error may escape.
    throw new DemoProvisioningError();
  }
}
