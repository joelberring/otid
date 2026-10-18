import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { asc, eq } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { previewShortenedCourseClassTransferAsAdministrator, transferShortenedCourseClassAsAdministrator } from "../../src/shortened-course-class-transfer";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/hash";
import { listAdministratorForestWatch } from "../../src/start-checkin-roster";
import { exportIofResultListAsAdmin } from "../../src/result-list-export";
import { listResultFinalizationCandidatesAsAdmin } from "../../src/result-finalization";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för en uttryckligen isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-22T15:00:00.000Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function fixture(startRule: "FIXED" | "PUNCH" = "PUNCH") {
  const eventId = randomUUID(), raceId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK135','2026-09-22','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'TASK135','2026-09-22')", [raceId, eventId]);
  const issued = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "TASK135", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential }, { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  const auth = { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const exportIssued = await issuePairingAdminAccessCredential(db, { raceId, capability: "EXPORT_IOF_RESULT_LIST", label: "TASK135 export", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const exportLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: exportIssued.accessCredential }, { expectedRaceId: raceId, expectedCapability: "EXPORT_IOF_RESULT_LIST", now });
  if (exportLogin.status !== "authenticated") throw new Error("Synthetic export login failed");
  const finalizationIssued = await issuePairingAdminAccessCredential(db, { raceId, capability: "FINALIZE_RESULTS", label: "TASK135 finalization", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const finalizationLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: finalizationIssued.accessCredential }, { expectedRaceId: raceId, expectedCapability: "FINALIZE_RESULTS", now });
  if (finalizationLogin.status !== "authenticated") throw new Error("Synthetic finalization login failed");
  const createRequestId = randomUUID();
  const created = await createManualCourseClassAsAdministrator(db, { ...auth, idempotencyKey: `manual-course-class-create:${createRequestId}`,
    request: { formatVersion: 1, requestId: createRequestId, expectedSnapshotVersion: 1,
      courseName: "Långa", className: "Öppen", startRule, controlCodes: [31, 42, 43] } }, now);
  if (created.status !== "created") throw new Error("Manual fixture failed");
  const mpEntryId = randomUUID(), noResultEntryId = randomUUID();
  const fixedStartTime = startRule === "FIXED" ? "2026-09-22T12:00:00.000Z" : null;
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name,fixed_start_time) VALUES($1,$2,$3,'Ada','MP',$4),($5,$2,$3,'Bo','Utan resultat',$4)",
    [mpEntryId, raceId, created.response.classId, fixedStartTime, noResultEntryId]);
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,'135001')", [raceId, mpEntryId]);
  const payload = { cardNumber: "135001", startPunchedAt: "2026-09-22T12:00:00Z", finishPunchedAt: "2026-09-22T12:20:00Z", punches: [
    { code: 31, punchedAt: "2026-09-22T12:05:00Z" }, { code: 42, punchedAt: "2026-09-22T12:10:00Z" }
  ] };
  await ingestDeviceBatch(db, raceId, { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: 2, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-09-22T12:21:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] });
  return { raceId, auth, exportAuth: { raceId, sessionToken: exportLogin.sessionToken },
    finalizationAuth: { raceId, sessionToken: finalizationLogin.sessionToken, csrfCookie: finalizationLogin.csrfToken, csrfHeader: finalizationLogin.csrfToken },
    created: created.response, mpEntryId, noResultEntryId, fixedStartTime };
}

it("TASK135 creates a separately ranked local short class, preserves the MP source and replays exactly", async () => {
  const f = await fixture();
  const candidate = await previewShortenedCourseClassTransferAsAdministrator(db, { ...f.auth,
    request: { formatVersion: 1, sourceClassId: f.created.classId } }, now);
  expect(candidate.status).toBe("ok");
  if (candidate.status !== "ok") return;
  expect(candidate.response.sourceControls.map(control => control.controlCode)).toEqual([31, 42, 43]);
  expect(candidate.response.entries.map(entry => entry.sourceResult.kind).sort()).toEqual(["CARD_READOUT_MP", "NO_RESULT"]);
  const mpCandidate = candidate.response.entries.find(entry => entry.entryId === f.mpEntryId);
  expect(mpCandidate?.sourceResult.kind).toBe("CARD_READOUT_MP");
  const sourceRows = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, f.mpEntryId));
  const rawBefore = await db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, f.raceId));
  const request = { formatVersion: 1 as const, requestId: randomUUID(), sourceClassId: f.created.classId,
    expectedSourceCourseVersionId: candidate.response.sourceCourseVersionId, expectedSourceStartRule: "PUNCH" as const,
    expectedSnapshotVersion: candidate.response.snapshotVersion, expectedBasisHash: candidate.response.basisHash,
    shortCourseName: "Långa kort", shortClassName: "Öppen kort", expectedSourceControlCount: 3,
    controlPrefix: candidate.response.sourceControls.slice(0, 2), entryIds: [f.mpEntryId, f.noResultEntryId].sort() };
  const changed = await transferShortenedCourseClassAsAdministrator(db, { ...f.auth,
    idempotencyKey: `shortened-course-class-transfer:${request.requestId}`, request }, now);
  expect(changed.status).toBe("transferred");
  if (changed.status !== "transferred") return;
  expect(changed.response.items.map(item => item.effect).sort()).toEqual(["MOVED_AND_REEVALUATED", "MOVED_ONLY"]);
  const [shortClass] = await db.select({ externalSource: schema.classes.externalSource, externalId: schema.classes.externalId })
    .from(schema.classes).where(eq(schema.classes.id, changed.response.shortClassId));
  const [shortCourse] = await db.select({ externalSource: schema.courses.externalSource, externalId: schema.courses.externalId })
    .from(schema.courses).where(eq(schema.courses.id, changed.response.shortCourseId));
  expect(shortClass).toEqual({ externalSource: null, externalId: null });
  expect(shortCourse).toEqual({ externalSource: null, externalId: null });
  const entries = await db.select().from(schema.entries).where(eq(schema.entries.raceId, f.raceId));
  expect(entries.filter(entry => entry.id === f.mpEntryId || entry.id === f.noResultEntryId)
    .every(entry => entry.classId === changed.response.shortClassId && entry.version === 2)).toBe(true);
  const mpRows = await db.select({ revision: schema.resultRevisions.revision, cause: schema.resultRevisions.cause,
    status: schema.resultRevisions.status, courseVersionId: schema.resultRevisions.courseVersionId, transferId: schema.resultRevisions.shortenedCourseClassTransferId })
    .from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, f.mpEntryId)).orderBy(asc(schema.resultRevisions.revision));
  expect(mpRows).toEqual([
    expect.objectContaining({ revision: 1, cause: "CARD_READOUT", status: "MP", courseVersionId: f.created.courseVersionId, transferId: null }),
    expect.objectContaining({ revision: 2, cause: "SHORTENED_COURSE_CLASS_TRANSFER", status: "OK", courseVersionId: changed.response.shortCourseVersionId, transferId: request.requestId })
  ]);
  const exported = await exportIofResultListAsAdmin(db, f.exportAuth, now);
  expect(exported.status).toBe("ok");
  if (exported.status === "ok") {
    const xml = new TextDecoder().decode(exported.bytes);
    expect(xml).toContain("<Name>Öppen kort</Name>");
    expect(xml).not.toContain("<Name>Öppen</Name>");
    expect(exported.metadata).toMatchObject({ classCount: 1, resultCount: 1, omittedEntryCount: 1 });
  }
  const finalization = await listResultFinalizationCandidatesAsAdmin(db, f.finalizationAuth, now);
  expect(finalization.status).toBe("ok");
  if (finalization.status === "ok") {
    expect(finalization.response.classes.find((raceClass) => raceClass.classId === changed.response.shortClassId)?.blockerCodes)
      .toContain("MISSING_RESULT_REVISION");
  }
  expect(await db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, f.raceId))).toEqual(rawBefore);
  expect(sourceRows).toHaveLength(1);
  expect((await db.select().from(schema.shortenedCourseClassTransfers).where(eq(schema.shortenedCourseClassTransfers.requestId, request.requestId))).length).toBe(1);
  expect((await db.select().from(schema.shortenedCourseClassTransferItems).where(eq(schema.shortenedCourseClassTransferItems.requestId, request.requestId))).length).toBe(2);
  expect(await transferShortenedCourseClassAsAdministrator(db, { ...f.auth,
    idempotencyKey: `shortened-course-class-transfer:${request.requestId}`, request }, now)).toEqual({ status: "transferred", response: { ...changed.response, replayed: true } });
  const forest = await listAdministratorForestWatch(db, f.auth, now);
  expect(forest.status).toBe("ok");
  if (forest.status === "ok") expect(forest.response.entries.find(entry => entry.entryId === f.mpEntryId)?.readoutReturnRegistered).toBe(true);
  await expect(pool.query("UPDATE shortened_course_class_transfer SET request=request WHERE request_id=$1", [request.requestId])).rejects.toThrow();
});

it("TASK135 rejects a stale candidate before creating a short class or transfer journal", async () => {
  const f = await fixture();
  const candidate = await previewShortenedCourseClassTransferAsAdministrator(db, { ...f.auth,
    request: { formatVersion: 1, sourceClassId: f.created.classId } }, now);
  if (candidate.status !== "ok") throw new Error("Candidate missing");
  await pool.query("UPDATE entry SET version=2 WHERE id=$1", [f.noResultEntryId]);
  const request = { formatVersion: 1 as const, requestId: randomUUID(), sourceClassId: f.created.classId,
    expectedSourceCourseVersionId: candidate.response.sourceCourseVersionId, expectedSourceStartRule: "PUNCH" as const,
    expectedSnapshotVersion: candidate.response.snapshotVersion, expectedBasisHash: candidate.response.basisHash,
    shortCourseName: "Långa kort", shortClassName: "Öppen kort", expectedSourceControlCount: 3,
    controlPrefix: candidate.response.sourceControls.slice(0, 2), entryIds: [f.noResultEntryId] };
  expect((await transferShortenedCourseClassAsAdministrator(db, { ...f.auth,
    idempotencyKey: `shortened-course-class-transfer:${request.requestId}`, request }, now)).status).toBe("conflict");
  expect((await db.select().from(schema.shortenedCourseClassTransfers).where(eq(schema.shortenedCourseClassTransfers.raceId, f.raceId))).length).toBe(0);
  expect((await db.select().from(schema.classes).where(eq(schema.classes.raceId, f.raceId))).length).toBe(1);
});

it("TASK135 preserves an exact FIXED start when a resultless entry moves to the short class", async () => {
  const f = await fixture("FIXED");
  const candidate = await previewShortenedCourseClassTransferAsAdministrator(db, { ...f.auth,
    request: { formatVersion: 1, sourceClassId: f.created.classId } }, now);
  if (candidate.status !== "ok" || f.fixedStartTime === null) throw new Error("FIXED candidate missing");
  const noResult = candidate.response.entries.find((entry) => entry.entryId === f.noResultEntryId);
  expect(noResult).toMatchObject({ startRule: "FIXED", fixedStartTime: f.fixedStartTime, sourceResult: { kind: "NO_RESULT" } });
  const request = { formatVersion: 1 as const, requestId: randomUUID(), sourceClassId: f.created.classId,
    expectedSourceCourseVersionId: candidate.response.sourceCourseVersionId, expectedSourceStartRule: "FIXED" as const,
    expectedSnapshotVersion: candidate.response.snapshotVersion, expectedBasisHash: candidate.response.basisHash,
    shortCourseName: "Långa FIXED kort", shortClassName: "Öppen FIXED kort", expectedSourceControlCount: 3,
    controlPrefix: candidate.response.sourceControls.slice(0, 2), entryIds: [f.noResultEntryId] };
  const changed = await transferShortenedCourseClassAsAdministrator(db, { ...f.auth,
    idempotencyKey: `shortened-course-class-transfer:${request.requestId}`, request }, now);
  expect(changed.status).toBe("transferred");
  if (changed.status !== "transferred") return;
  const [shortClass] = await db.select({ startRule: schema.classes.startRule, courseVersionId: schema.classes.courseVersionId })
    .from(schema.classes).where(eq(schema.classes.id, changed.response.shortClassId));
  const [moved] = await db.select({ classId: schema.entries.classId, fixedStartTime: schema.entries.fixedStartTime })
    .from(schema.entries).where(eq(schema.entries.id, f.noResultEntryId));
  expect(shortClass).toEqual({ startRule: "FIXED", courseVersionId: changed.response.shortCourseVersionId });
  expect(moved).toMatchObject({ classId: changed.response.shortClassId, fixedStartTime: new Date(f.fixedStartTime) });
  expect((await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, f.noResultEntryId))).length).toBe(0);
});
