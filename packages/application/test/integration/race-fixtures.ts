import { readFile } from "node:fs/promises";
import { afterAll, beforeAll } from "vitest";
import { asc, desc, eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { contentHash, createEvent, importIofXml } from "../../src";
import { loadRaceSnapshot, sortRaceSnapshotForPackage } from "../../src/snapshot";

/**
 * Gemensamt underlag för integrationstesterna som delades ut från den gamla `task-001.test.ts` (steg 23):
 * databasen, IOF-fixturerna och ett importerat testlopp.
 */
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL eller DATABASE_URL krävs för PostgreSQL-integrationstester");
export const { db, pool } = createDatabase(connectionString);

const iofFixture = (name: string) => readFile(new URL(`../../../../fixtures/iof/${name}`, import.meta.url), "utf8");
export const courseXml = await iofFixture("course-data.xml");
export const entryXml = await iofFixture("entry-list.xml");
export const startListXml = await iofFixture("start-list.xml");

/** Migrerar testdatabasen före filens tester och stänger poolen efteråt. */
export function useRaceDatabase(): void {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
  });
  afterAll(async () => pool.end());
}

/** Avläsningens ögonblicksbild av loppet (samma innehåll som avläsningspaketet). */
export async function readoutPackage(raceId: string) {
  const raceSnapshot = sortRaceSnapshotForPackage(await loadRaceSnapshot(db, raceId));
  return { packageVersion: raceSnapshot.race.snapshotVersion, raceSnapshot };
}

export async function importedRace() {
  const suffix = crypto.randomUUID().slice(0, 8);
  const { race } = await createEvent(db, {
    name: `Test ${suffix}`, raceName: "Individuellt", raceDate: "2026-08-30", timeZone: "Europe/Stockholm"
  });
  await importIofXml(db, race.id, courseXml);
  await importIofXml(db, race.id, entryXml);
  return { raceId: race.id, overview: await trustedRaceFixtureOverview(race.id) };
}

export async function trustedRaceFixtureOverview(raceId: string) {
  const [race] = await db.select({
    id: schema.races.id,
    name: schema.races.name,
    raceDate: schema.races.raceDate,
    snapshotVersion: schema.races.snapshotVersion,
    eventName: schema.events.name
  }).from(schema.races).innerJoin(schema.events, eq(schema.races.eventId, schema.events.id))
    .where(eq(schema.races.id, raceId));
  if (!race) throw new Error("Testloppet finns inte");
  const [classes, courses, entries, imports] = await Promise.all([
    db.select().from(schema.classes).where(eq(schema.classes.raceId, raceId)).orderBy(asc(schema.classes.name)),
    db.select().from(schema.courses).where(eq(schema.courses.raceId, raceId)).orderBy(asc(schema.courses.name)),
    db.select({
      id: schema.entries.id,
      givenName: schema.entries.givenName,
      familyName: schema.entries.familyName,
      organisationName: schema.entries.organisationName,
      classId: schema.entries.classId,
      className: schema.classes.name,
      cardNumber: schema.cardAssignments.cardNumber
    }).from(schema.entries)
      .innerJoin(schema.classes, eq(schema.entries.classId, schema.classes.id))
      .leftJoin(schema.cardAssignments, eq(schema.entries.id, schema.cardAssignments.entryId))
      .where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.familyName)),
    db.select().from(schema.importFiles).where(eq(schema.importFiles.raceId, raceId))
      .orderBy(desc(schema.importFiles.createdAt))
  ]);
  return { race, classes, courses, entries, imports };
}

export function batch(deviceId: string, payload: {
  cardNumber: string;
  startPunchedAt: string;
  finishPunchedAt: string;
  punches: Array<{ code: number; punchedAt: string }>;
}, options: {
  localSequence?: number;
  packageVersion?: number;
  sessionId?: string;
  stationReceivedAt?: string;
} = {}) {
  const localSequence = options.localSequence ?? 1;
  return {
    deviceId,
    sessionId: options.sessionId ?? deviceId,
    packageVersion: options.packageVersion ?? 3,
    firstSequence: localSequence,
    lastSequence: localSequence,
    events: [{
      localSequence,
      stationReceivedAt: options.stationReceivedAt ?? "2026-08-30T10:41:00Z",
      transport: "simulator" as const,
      payload,
      contentHash: contentHash(payload)
    }]
  };
}

export const okPayload = {
  cardNumber: "12345",
  startPunchedAt: "2026-08-30T10:00:00Z",
  finishPunchedAt: "2026-08-30T10:40:00Z",
  punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: `2026-08-30T10:${10 + index * 10}:00Z` }))
};
