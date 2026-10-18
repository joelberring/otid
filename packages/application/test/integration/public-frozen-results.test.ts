import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "@o-tid/database";
import { createDatabase, schema } from "@o-tid/database";
import { readLatestPublicFrozenRaceFinalization, readPublicFrozenRaceResults } from "../../src/result-finalization";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

const hash = "a".repeat(64);
const finalizedAt = new Date("2026-09-21T14:30:00.000Z");
const completeXml = "<ResultList status=\"Complete\" />";

function person() {
  return {
    entryExternalId: null,
    givenName: "Ada",
    familyName: "Löpare",
    organisationName: "Centrum OK",
    startTime: "2026-09-21T10:00:00.000Z",
    finishTime: "2026-09-21T10:30:00.000Z",
    elapsedMs: 1_800_000,
    position: 1,
    timeBehindMs: 0,
    expectedControls: [],
    splits: [],
    status: "OK" as const,
    manualApprovalProof: null
  };
}

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const classId = randomUUID(), actorCredentialId = randomUUID(), finalizationId = randomUUID(), classFinalizationId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "Live-namn som får ändras", startsOn: "2026-09-21", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Långdistans", raceDate: "2026-09-21" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Bana 1" });
  await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
  await db.insert(schema.classes).values({ id: classId, raceId, courseVersionId, name: "H21", startRule: "PUNCH" });
  await db.insert(schema.pairingAdminAccessCredentials).values({
    id: actorCredentialId, raceId, capability: "FINALIZE_RESULTS", label: "TASK127 syntetisk", secretHash: hash,
    issuedAt: new Date("2026-09-21T14:00:00.000Z"), expiresAt: new Date("2026-09-21T15:00:00.000Z")
  });
  const result = { source: { entryId: randomUUID(), resultRevisionId: randomUUID(), revision: 1, courseVersionId,
    kind: "READOUT_RESULT" as const, readoutId: randomUUID() }, personResult: person() };
  const classData = { name: "H21", externalId: null, results: [result] };
  const raceProjection = { formatVersion: 9 as const, scope: "RACE" as const, raceId, snapshotVersion: 1,
    basisSha256: hash, eventName: "Skärgårdshelgen lång", classes: [{ classFinalizationId, classFinalizationRevision: 1,
      classBasisSha256: hash, classId, class: classData }] };
  await db.insert(schema.resultFinalizations).values({
    id: finalizationId, requestId: randomUUID(), raceId, scope: "RACE", classId: null, scopeRevision: 1,
    sourceSnapshotVersion: 1, sourceHash: hash, frozenProjection: raceProjection, completeXml,
    completeXmlHash: createHash("sha256").update(completeXml).digest("hex"), actorCredentialId, finalizedAt
  });
  const classProjection = { formatVersion: 9 as const, scope: "CLASS" as const, raceId, classId,
    snapshotVersion: 1, basisSha256: hash, class: classData };
  await db.insert(schema.resultFinalizations).values({
    id: classFinalizationId, requestId: randomUUID(), raceId, scope: "CLASS", classId, scopeRevision: 1,
    sourceSnapshotVersion: 1, sourceHash: hash, frozenProjection: classProjection, completeXml: null,
    completeXmlHash: null, actorCredentialId, finalizedAt
  });
  return { eventId, raceId, finalizationId, classFinalizationId };
}

describe("TASK127 publik fryst resultatprojektion", () => {
  it("läser en explicit RACE-finalisering utan live-resultat och håller den stabil efter senare displayändring", async () => {
    const f = await fixture();
    const before = await readPublicFrozenRaceResults(db, f.raceId, f.finalizationId);
    expect(before).toEqual({ status: "ok", response: {
      formatVersion: 1, eventName: "Skärgårdshelgen lång", finalizedAt: finalizedAt.toISOString(), results: [{
        className: "H21", givenName: "Ada", familyName: "Löpare", organisationName: "Centrum OK",
        status: "OK", elapsedMs: 1_800_000, position: 1, timeBehindMs: 0
      }]
    } });
    await db.update(schema.events).set({ name: "Senare live-namn" }).where(eq(schema.events.id, f.eventId));
    expect(await readPublicFrozenRaceResults(db, f.raceId, f.finalizationId)).toEqual(before);
    expect(await readLatestPublicFrozenRaceFinalization(db, f.raceId)).toEqual({ status: "ok", finalizationId: f.finalizationId });
  });

  it("stänger vid fel race, saknad rad och CLASS-finalisering utan live-fallback", async () => {
    const f = await fixture();
    expect(await readPublicFrozenRaceResults(db, randomUUID(), f.finalizationId)).toEqual({ status: "not-found" });
    expect(await readPublicFrozenRaceResults(db, f.raceId, randomUUID())).toEqual({ status: "not-found" });
    expect(await readPublicFrozenRaceResults(db, f.raceId, f.classFinalizationId)).toEqual({ status: "not-found" });
  });
});
