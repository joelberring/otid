import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { previewManualCourseVersionClassRelinkAsAdministrator, relinkManualCourseVersionClassAsAdministrator } from "../../src/manual-course-version-class-relink";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/hash";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för en uttryckligen isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-19T13:00:00.000Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK082','2026-09-19','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'TASK082','2026-09-19')", [raceId, eventId]);
  const issued = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "TASK082",
    expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential },
    { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  const auth = { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const createRequest = { formatVersion: 1 as const, requestId: randomUUID(), expectedSnapshotVersion: 1,
    courseName: "Manuell", className: "Öppen", startRule: "PUNCH" as const, controlCodes: [31, 42, 31] };
  const created = await createManualCourseClassAsAdministrator(db, { ...auth, idempotencyKey: `manual-course-class-create:${createRequest.requestId}`, request: createRequest }, now);
  if (created.status !== "created") throw new Error("Manual fixture failed");
  const entryId = randomUUID();
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$2,$3,'Ada','TASK082')",
    [entryId, raceId, created.response.classId]);
  const request = { formatVersion: 1 as const, requestId: randomUUID(), expectedSnapshotVersion: 2,
    courseId: created.response.courseId, classId: created.response.classId,
    expectedClassCourseVersionId: created.response.courseVersionId, controlCodes: [31, 31, 42] };
  return { raceId, auth, entryId, created: created.response, request, key: `manual-course-version-link:${request.requestId}` };
}

it("TASK082 appends a manual version, relinks only the class and exactly replays", async () => {
  const f = await fixture();
  const preview = await previewManualCourseVersionClassRelinkAsAdministrator(db, { ...f.auth, classId: f.request.classId }, now);
  expect(preview.status).toBe("ok");
  if (preview.status === "ok") expect(preview.response).toMatchObject({ entryCount: 1, resultRevisionCount: 0, canRelink: true, controlCodes: [31, 42, 31] });
  const changed = await relinkManualCourseVersionClassAsAdministrator(db, { ...f.auth, idempotencyKey: f.key, request: f.request }, now);
  expect(changed.status).toBe("changed");
  if (changed.status !== "changed") return;
  expect(changed.response).toMatchObject({ previousCourseVersion: 1, courseVersion: 2, entryCount: 1,
    snapshotVersionBefore: 2, snapshotVersionAfter: 3, request: f.request });
  expect((await pool.query<{ code: number }>("SELECT c.code FROM course_control cc JOIN control c ON c.id=cc.control_id WHERE cc.course_version_id=$1 ORDER BY cc.sequence", [changed.response.courseVersionId])).rows.map(row => row.code)).toEqual([31, 31, 42]);
  expect((await pool.query("SELECT class_id,version,fixed_start_time FROM entry WHERE id=$1", [f.entryId])).rows)
    .toEqual([{ class_id: f.created.classId, version: 1, fixed_start_time: null }]);
  expect((await pool.query<{ count: string }>("SELECT count(*) FROM course_version WHERE course_id=$1", [f.created.courseId])).rows[0]?.count).toBe("2");
  const replay = await relinkManualCourseVersionClassAsAdministrator(db, { ...f.auth, idempotencyKey: f.key, request: f.request }, now);
  expect(replay).toEqual({ status: "changed", response: { ...changed.response, replayed: true } });
  expect((await relinkManualCourseVersionClassAsAdministrator(db, { ...f.auth, idempotencyKey: f.key,
    request: { ...f.request, controlCodes: [31, 42] } }, now)).status).toBe("conflict");
  expect((await pool.query<{ count: string }>("SELECT count(*) FROM course_version WHERE course_id=$1", [f.created.courseId])).rows[0]?.count).toBe("2");
  await expect(pool.query("UPDATE manual_course_version_class_relink_request SET request=request WHERE request_id=$1", [f.request.requestId])).rejects.toThrow();
  await expect(pool.query("DELETE FROM manual_course_version_class_relink_request WHERE request_id=$1", [f.request.requestId])).rejects.toThrow();
  await expect(pool.query("UPDATE course_control SET sequence=sequence WHERE course_version_id=$1", [f.created.courseVersionId])).rejects.toThrow();
});

it("TASK082 blocks every existing result revision before any version write", async () => {
  const f = await fixture();
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,'82001')", [f.raceId, f.entryId]);
  const payload = { cardNumber: "82001", startPunchedAt: "2026-09-19T12:00:00Z", finishPunchedAt: "2026-09-19T12:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-19T12:05:00Z" }, { code: 42, punchedAt: "2026-09-19T12:10:00Z" }, { code: 31, punchedAt: "2026-09-19T12:15:00Z" }] };
  const deviceId = randomUUID();
  await ingestDeviceBatch(db, f.raceId, { deviceId, sessionId: deviceId, packageVersion: 2, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-09-19T12:21:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] });
  const preview = await previewManualCourseVersionClassRelinkAsAdministrator(db, { ...f.auth, classId: f.request.classId }, now);
  expect(preview.status === "ok" && preview.response).toMatchObject({ resultRevisionCount: 1, canRelink: false });
  expect((await relinkManualCourseVersionClassAsAdministrator(db, { ...f.auth, idempotencyKey: f.key, request: f.request }, now)).status).toBe("results-exist");
  expect((await pool.query<{ count: string }>("SELECT count(*) FROM course_version WHERE course_id=$1", [f.created.courseId])).rows[0]?.count).toBe("1");
  expect((await pool.query<{ snapshot_version: number }>("SELECT snapshot_version FROM race WHERE id=$1", [f.raceId])).rows[0]?.snapshot_version).toBe(2);
});

it("TASK082 rejects stale, imported and mismatched course/class intents without writes", async () => {
  const f = await fixture();
  const before = await pool.query("SELECT count(*) FROM course_version WHERE course_id=$1", [f.created.courseId]);
  expect((await relinkManualCourseVersionClassAsAdministrator(db, { ...f.auth, idempotencyKey: f.key,
    request: { ...f.request, expectedSnapshotVersion: 1 } }, now)).status).toBe("conflict");
  await pool.query("UPDATE course SET external_source='IOF',external_id='x' WHERE id=$1", [f.created.courseId]);
  expect((await relinkManualCourseVersionClassAsAdministrator(db, { ...f.auth, idempotencyKey: f.key, request: f.request }, now)).status).toBe("not-found");
  await pool.query("UPDATE course SET external_source=NULL,external_id=NULL WHERE id=$1", [f.created.courseId]);
  expect((await relinkManualCourseVersionClassAsAdministrator(db, { ...f.auth, idempotencyKey: f.key,
    request: { ...f.request, expectedClassCourseVersionId: randomUUID() } }, now)).status).toBe("not-found");
  expect((await pool.query("SELECT count(*) FROM course_version WHERE course_id=$1", [f.created.courseId])).rows).toEqual(before.rows);
});

it("TASK082 serializes an ingest and relink without changing result history's banreferens", async () => {
  const f = await fixture();
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,'82002')", [f.raceId, f.entryId]);
  const payload = { cardNumber: "82002", startPunchedAt: "2026-09-19T12:00:00Z", finishPunchedAt: "2026-09-19T12:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-19T12:05:00Z" }, { code: 42, punchedAt: "2026-09-19T12:10:00Z" }, { code: 31, punchedAt: "2026-09-19T12:15:00Z" }] };
  const deviceId = randomUUID();
  const [relink, ingest] = await Promise.all([
    relinkManualCourseVersionClassAsAdministrator(db, { ...f.auth, idempotencyKey: f.key, request: f.request }, now),
    ingestDeviceBatch(db, f.raceId, { deviceId, sessionId: deviceId, packageVersion: 2, firstSequence: 1, lastSequence: 1,
      events: [{ localSequence: 1, stationReceivedAt: "2026-09-19T12:21:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] })
  ]);
  expect(ingest.acknowledgements[0]?.status).toBe("stored");
  const entries = await pool.query<{ class_id: string }>("SELECT class_id FROM entry WHERE id=$1", [f.entryId]);
  const results = await pool.query<{ course_version_id: string; snapshot_version: number }>(
    "SELECT course_version_id,snapshot_version FROM result_revision WHERE entry_id=$1", [f.entryId]);
  const entry = entries.rows[0], result = results.rows[0];
  expect(results.rows).toHaveLength(1);
  if (relink.status === "changed") {
    expect(entry?.class_id).toBe(f.created.classId);
    expect(result?.course_version_id).toBe(relink.response.courseVersionId);
    expect(result?.snapshot_version).toBe(relink.response.snapshotVersionAfter);
  } else {
    expect(relink.status).toBe("results-exist");
    expect(entry?.class_id).toBe(f.created.classId);
    expect(result?.course_version_id).toBe(f.created.courseVersionId);
    expect(result?.snapshot_version).toBe(2);
  }
});
