import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import { importIofXml } from "./import-iof";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL måste anges");
const eventId = "10000000-0000-4000-8000-000000000001";
const raceId = "10000000-0000-4000-8000-000000000002";
const { db, pool } = createDatabase(connectionString);

try {
  await db.insert(schema.events).values({
    id: eventId,
    name: "O-Tid demotävling",
    startsOn: "2026-08-30",
    timeZone: "Europe/Stockholm"
  }).onConflictDoNothing();
  await db.insert(schema.races).values({
    id: raceId,
    eventId,
    name: "Individuellt lopp",
    raceDate: "2026-08-30"
  }).onConflictDoNothing();
  const courseXml = await readFile(new URL("../../../fixtures/iof/course-data.xml", import.meta.url), "utf8");
  const entryXml = await readFile(new URL("../../../fixtures/iof/entry-list.xml", import.meta.url), "utf8");
  await importIofXml(db, raceId, courseXml);
  await importIofXml(db, raceId, entryXml);
  const [race] = await db.select().from(schema.races).where(and(eq(schema.races.id, raceId), eq(schema.races.eventId, eventId)));
  console.log(JSON.stringify({ eventId, raceId, snapshotVersion: race?.snapshotVersion }));
} finally {
  await pool.end();
}
