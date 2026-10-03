import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "@o-tid/database";
import { createDatabase, schema } from "@o-tid/database";
import { contentHash } from "../../src/hash";
import { ingestDeviceBatch } from "../../src/ingest";
import { publicResultDetail, publicResults } from "../../src/results";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);

beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function fixture(givenName: string, publicResultId?: string) {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID();
  const courseVersionId = randomUUID(), classId = randomUUID(), entryId = randomUUID(), controlId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "Syntetisk publik detalj", startsOn: "2026-09-19", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Detaljlopp", raceDate: "2026-09-19" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Syntetisk bana" });
  await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
  await db.insert(schema.controls).values({ id: controlId, raceId, code: 31 });
  await db.insert(schema.courseControls).values({ courseVersionId, controlId, sequence: 1 });
  await db.insert(schema.classes).values({ id: classId, raceId, courseVersionId, name: "H21", startRule: "FIXED" });
  await db.insert(schema.entries).values({
    id: entryId, raceId, classId, givenName, familyName: "Syntetisk", organisationName: "Test OK",
    fixedStartTime: new Date("2026-09-19T10:00:00Z"),
    ...(publicResultId ? { publicResultId } : {})
  });
  await db.insert(schema.cardAssignments).values({ raceId, entryId, cardNumber: `89${entryId.slice(0, 8)}` });
  const payload = {
    cardNumber: `89${entryId.slice(0, 8)}`,
    startPunchedAt: "2026-09-19T10:00:00Z",
    finishPunchedAt: "2026-09-19T10:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-19T10:10:00Z" }]
  };
  const deviceId = randomUUID();
  await ingestDeviceBatch(db, raceId, {
    deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-09-19T10:21:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }]
  });
  const [entry] = await db.select({ publicResultId: schema.entries.publicResultId }).from(schema.entries)
    .where(eq(schema.entries.id, entryId));
  if (!entry) throw new Error("Synthetic entry missing");
  return { raceId, classId, entryId, publicResultId: entry.publicResultId };
}

describe("TASK089 public result detail PostgreSQL projection", () => {
  it("uses a stable opaque identity, enforces race scope, and returns the exact public row only", async () => {
    const first = await fixture("Ada");
    const second = await fixture("Bea", first.publicResultId);
    const list = await publicResults(db, first.raceId);
    expect(list.formatVersion).toBe(7);
    const listRow = list.results[0];
    expect(listRow).toMatchObject({ publicResultId: first.publicResultId, givenName: "Ada" });
    const detail = await publicResultDetail(db, first.raceId, first.publicResultId);
    expect(detail).toEqual({ status: "ok", response: { formatVersion: 1, result: listRow } });
    expect(await publicResultDetail(db, first.raceId, randomUUID())).toEqual({ status: "not-found" });
    expect(await publicResultDetail(db, first.raceId, "not-an-id")).toEqual({ status: "not-found" });
    expect((await publicResultDetail(db, second.raceId, first.publicResultId))).toMatchObject({
      status: "ok", response: { result: { givenName: "Bea", publicResultId: first.publicResultId } }
    });
  });

  it("keeps the link through an identity correction and fails closed for an entry without a published result", async () => {
    const f = await fixture("Cecilia");
    await db.update(schema.entries).set({ givenName: "Cecilia Rättad" }).where(eq(schema.entries.id, f.entryId));
    expect(await publicResultDetail(db, f.raceId, f.publicResultId)).toMatchObject({
      status: "ok", response: { result: { publicResultId: f.publicResultId, givenName: "Cecilia Rättad" } }
    });
    const noResultPublicId = randomUUID();
    await db.insert(schema.entries).values({
      id: randomUUID(),
      raceId: f.raceId,
      classId: f.classId,
      givenName: "Opubl",
      familyName: "Result",
      organisationName: "Test OK",
      publicResultId: noResultPublicId
    });
    expect(await publicResultDetail(db, f.raceId, noResultPublicId)).toEqual({ status: "not-found" });
  });
});
