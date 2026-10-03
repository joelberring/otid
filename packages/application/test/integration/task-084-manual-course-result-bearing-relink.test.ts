import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { previewManualCourseResultBearingRelinkAsAdministrator, relinkManualCourseResultBearingClassAsAdministrator } from "../../src/manual-course-result-bearing-relink";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/hash";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för en uttryckligen isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-19T15:00:00.000Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK084','2026-09-19','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'TASK084','2026-09-19')", [raceId, eventId]);
  const issued = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "TASK084", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential }, { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  const auth = { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const createRequestId = randomUUID();
  const created = await createManualCourseClassAsAdministrator(db, { ...auth, idempotencyKey: `manual-course-class-create:${createRequestId}`,
    request: { formatVersion: 1, requestId: createRequestId, expectedSnapshotVersion: 1, courseName: "Manuell", className: "Öppen", startRule: "PUNCH", controlCodes: [31, 42] } }, now);
  if (created.status !== "created") throw new Error("Manual fixture failed");
  const entryId = randomUUID();
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$2,$3,'Ada','TASK084')", [entryId, raceId, created.response.classId]);
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,'84001')", [raceId, entryId]);
  const payload = { cardNumber: "84001", startPunchedAt: "2026-09-19T12:00:00Z", finishPunchedAt: "2026-09-19T12:20:00Z", punches: [
    { code: 31, punchedAt: "2026-09-19T12:05:00Z" }, { code: 42, punchedAt: "2026-09-19T12:10:00Z" }
  ] };
  await ingestDeviceBatch(db, raceId, { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: 2, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-09-19T12:21:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] });
  return { raceId, auth, entryId, created: created.response };
}

it("TASK084 relinks a result-bearing manual class without rewriting result history and exactly replays", async () => {
  const f = await fixture();
  const candidate = await previewManualCourseResultBearingRelinkAsAdministrator(db, { ...f.auth, classId: f.created.classId }, now);
  expect(candidate.status).toBe("ok");
  if (candidate.status !== "ok") return;
  expect(candidate.response).toMatchObject({ courseName: "Manuell", className: "Öppen", currentControlCodes: [31, 42], historicalResultRevisionCount: 1 });
  const before = await pool.query("SELECT id,revision,course_version_id,evaluation FROM result_revision WHERE entry_id=$1", [f.entryId]);
  const request = { formatVersion: 1 as const, requestId: randomUUID(), expectedSnapshotVersion: candidate.response.snapshotVersion,
    expectedBasisHash: candidate.response.basisHash, courseId: f.created.courseId, classId: f.created.classId,
    expectedClassCourseVersionId: f.created.courseVersionId, controlCodes: [42, 31, 42], acknowledgedImpact: true as const };
  const key = `manual-course-result-bearing-link:${request.requestId}`;
  const changed = await relinkManualCourseResultBearingClassAsAdministrator(db, { ...f.auth, idempotencyKey: key, request }, now);
  expect(changed.status).toBe("changed");
  if (changed.status !== "changed") return;
  expect(changed.response).toMatchObject({ previousCourseVersionId: f.created.courseVersionId, courseVersion: 2, sourceBasisHash: candidate.response.basisHash, snapshotVersionAfter: 3 });
  expect((await pool.query("SELECT id,revision,course_version_id,evaluation FROM result_revision WHERE entry_id=$1", [f.entryId])).rows).toEqual(before.rows);
  expect((await pool.query<{ course_version_id: string }>("SELECT course_version_id FROM class WHERE id=$1", [f.created.classId])).rows[0]?.course_version_id).toBe(changed.response.courseVersionId);
  expect((await pool.query<{ count: string }>("SELECT count(*) FROM manual_course_result_bearing_relink_request WHERE request_id=$1", [request.requestId])).rows[0]?.count).toBe("1");
  expect(await relinkManualCourseResultBearingClassAsAdministrator(db, { ...f.auth, idempotencyKey: key, request }, now)).toEqual({ status: "changed", response: { ...changed.response, replayed: true } });
  await expect(pool.query("UPDATE manual_course_result_bearing_relink_request SET request=request WHERE request_id=$1", [request.requestId])).rejects.toThrow();
});

it("TASK084 rejects a stale semantic candidate without a partial course version", async () => {
  const f = await fixture();
  const candidate = await previewManualCourseResultBearingRelinkAsAdministrator(db, { ...f.auth, classId: f.created.classId }, now);
  if (candidate.status !== "ok") throw new Error("Candidate missing");
  await pool.query("UPDATE entry SET version=2 WHERE id=$1", [f.entryId]);
  const request = { formatVersion: 1 as const, requestId: randomUUID(), expectedSnapshotVersion: candidate.response.snapshotVersion,
    expectedBasisHash: candidate.response.basisHash, courseId: f.created.courseId, classId: f.created.classId,
    expectedClassCourseVersionId: f.created.courseVersionId, controlCodes: [42, 31], acknowledgedImpact: true as const };
  expect((await relinkManualCourseResultBearingClassAsAdministrator(db, { ...f.auth,
    idempotencyKey: `manual-course-result-bearing-link:${request.requestId}`, request }, now)).status).toBe("conflict");
  expect((await pool.query<{ count: string }>("SELECT count(*) FROM course_version WHERE course_id=$1", [f.created.courseId])).rows[0]?.count).toBe("1");
});

it("TASK097 rejects a shortened prefix without a partial course version or journal", async () => {
  const f = await fixture();
  const candidate = await previewManualCourseResultBearingRelinkAsAdministrator(db, { ...f.auth, classId: f.created.classId }, now);
  if (candidate.status !== "ok") throw new Error("Candidate missing");
  const request = { formatVersion: 1 as const, requestId: randomUUID(), expectedSnapshotVersion: candidate.response.snapshotVersion,
    expectedBasisHash: candidate.response.basisHash, courseId: f.created.courseId, classId: f.created.classId,
    expectedClassCourseVersionId: f.created.courseVersionId, controlCodes: [31], acknowledgedImpact: true as const };
  expect((await relinkManualCourseResultBearingClassAsAdministrator(db, { ...f.auth,
    idempotencyKey: `manual-course-result-bearing-link:${request.requestId}`, request }, now)).status).toBe("invalid-request");
  expect((await pool.query<{ count: string }>("SELECT count(*) FROM course_version WHERE course_id=$1", [f.created.courseId])).rows[0]?.count).toBe("1");
  expect((await pool.query<{ count: string }>("SELECT count(*) FROM manual_course_result_bearing_relink_request WHERE race_id=$1", [f.raceId])).rows[0]?.count).toBe("0");
});
