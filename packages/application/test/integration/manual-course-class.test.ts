import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { createManualClassAsAdmin } from "../../src/manual-class";
import { importIofXml } from "../../src/import-iof";
import { raceLogin } from "./accounts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för en uttryckligen isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-19T12:00:00.000Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK081','2026-09-19','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'TASK081','2026-09-19')", [raceId, eventId]);
  const login = await raceLogin(db, raceId, "ADMIN", now);
  const auth = { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const request = { formatVersion: 1 as const, requestId: randomUUID(), courseName: "Manuell bana", className: "Öppen", startRule: "PUNCH" as const, controlCodes: [31, 42, 31] };
  return { raceId, auth, request, key: `manual-course-class-create:${request.requestId}` };
}

it("TASK081 creates an ordered manual course/class once and protects its history", async () => {
  const f = await fixture();
  const created = await createManualCourseClassAsAdmin(db, { ...f.auth, idempotencyKey: f.key, request: f.request }, now);
  expect(created.status).toBe("created");
  if (created.status !== "created") return;
  expect(created.response).toMatchObject({ snapshotVersionBefore: 1, snapshotVersionAfter: 2, request: f.request });
  expect((await pool.query("SELECT external_source,external_id,start_rule,max_entries,capacity_version FROM class WHERE id=$1", [created.response.classId])).rows[0])
    .toEqual({ external_source: null, external_id: null, start_rule: "PUNCH", max_entries: null, capacity_version: 1 });
  expect((await pool.query<{ code: number }>("SELECT c.code FROM course_control cc JOIN control c ON c.id=cc.control_id WHERE cc.course_version_id=$1 ORDER BY cc.sequence", [created.response.courseVersionId])).rows.map(row => row.code)).toEqual([31, 42, 31]);
  const replay = await createManualCourseClassAsAdmin(db, { ...f.auth, idempotencyKey: f.key, request: f.request }, now);
  expect(replay.status === "created" && replay.response.replayed).toBe(true);
  const otherLogin = await raceLogin(db, f.raceId, "ADMIN", now);
  expect((await createManualCourseClassAsAdmin(db, { raceId: f.raceId, sessionToken: otherLogin.sessionToken,
    csrfCookie: otherLogin.csrfToken, csrfHeader: otherLogin.csrfToken, idempotencyKey: f.key, request: f.request }, now)).status).toBe("conflict");
  expect((await pool.query<{ snapshot_version: number }>("SELECT snapshot_version FROM race WHERE id=$1", [f.raceId])).rows[0]?.snapshot_version).toBe(2);
  await expect(pool.query("UPDATE course_control SET sequence=sequence WHERE course_version_id=$1", [created.response.courseVersionId])).rejects.toThrow();
  await expect(pool.query("UPDATE manual_course_class_create_request SET request=request WHERE request_id=$1", [f.request.requestId])).rejects.toThrow();
  await expect(pool.query("DELETE FROM manual_course_class_create_request WHERE request_id=$1", [f.request.requestId])).rejects.toThrow();
  await expect(pool.query("DELETE FROM course_control WHERE course_version_id=$1", [created.response.courseVersionId])).rejects.toThrow();
  expect((await createManualCourseClassAsAdmin(db, { ...f.auth, idempotencyKey: f.key,
    request: { ...f.request, className: "Ändrad" } }, now)).status).toBe("conflict");
});

it("TASK081 preserves manual objects across IOF import and rejects a limited credential", async () => {
  const f = await fixture();
  const limitedLogin = await raceLogin(db, f.raceId, "FUNCTIONARY", now);
  expect((await createManualCourseClassAsAdmin(db, { raceId: f.raceId, sessionToken: limitedLogin.sessionToken,
    csrfCookie: limitedLogin.csrfToken, csrfHeader: limitedLogin.csrfToken, idempotencyKey: f.key, request: f.request }, now)).status).toBe("forbidden");
  const xml = await readFile(new URL("../../../../fixtures/iof/course-data.xml", import.meta.url), "utf8");
  await importIofXml(db, f.raceId, xml);
  const created = await createManualCourseClassAsAdmin(db, { ...f.auth, idempotencyKey: f.key,
    request: f.request }, now);
  expect(created.status).toBe("created");
  if (created.status !== "created") return;
  await importIofXml(db, f.raceId, xml);
  expect((await pool.query("SELECT external_source,external_id FROM course WHERE id=$1", [created.response.courseId])).rows[0])
    .toEqual({ external_source: null, external_id: null });
  const imported = (await pool.query<{ course_version_id: string }>(
    "SELECT cv.id AS course_version_id FROM course_version cv JOIN course c ON c.id=cv.course_id " +
    "WHERE c.race_id=$1 AND c.external_source IS NOT NULL AND EXISTS " +
    "(SELECT 1 FROM course_control cc WHERE cc.course_version_id=cv.id) ORDER BY cv.version LIMIT 1", [f.raceId])).rows[0];
  if (!imported) throw new Error("Synthetic IOF course version missing");
  const importedRequest = { formatVersion: 1 as const, requestId: randomUUID(), courseVersionId: imported.course_version_id, className: "Manuell klass på IOF-bana", startRule: "FIXED" as const };
  const importedClass = await createManualClassAsAdmin(db, { ...f.auth,
    idempotencyKey: `manual-class-create:${importedRequest.requestId}`, request: importedRequest }, now);
  expect(importedClass.status).toBe("created");
  if (importedClass.status !== "created") return;
  expect((await pool.query("SELECT external_source,external_id,course_version_id FROM class WHERE id=$1", [importedClass.response.classId])).rows[0])
    .toEqual({ external_source: null, external_id: null, course_version_id: imported.course_version_id });
});

it("TASK300 adds two manual classes to one exact version without copying its course or controls", async () => {
  const f = await fixture();
  const source = await createManualCourseClassAsAdmin(db, { ...f.auth, idempotencyKey: f.key, request: f.request }, now);
  if (source.status !== "created") throw new Error("Synthetic source course not created");
  const counts = async () => (await pool.query<{ courses: string; versions: string; controls: string }>(
    "SELECT (SELECT count(*) FROM course WHERE race_id=$1) AS courses, " +
    "(SELECT count(*) FROM course_version WHERE course_id=$2) AS versions, " +
    "(SELECT count(*) FROM course_control WHERE course_version_id=$3) AS controls",
    [f.raceId, source.response.courseId, source.response.courseVersionId])).rows[0];
  const before = await counts();
  const firstRequest = { formatVersion: 1 as const, requestId: randomUUID(), courseVersionId: source.response.courseVersionId, className: "D40", startRule: "PUNCH" as const };
  const firstKey = `manual-class-create:${firstRequest.requestId}`;
  const first = await createManualClassAsAdmin(db, { ...f.auth, idempotencyKey: firstKey, request: firstRequest }, now);
  expect(first.status).toBe("created");
  if (first.status !== "created") return;
  expect(first.response).toMatchObject({ courseId: source.response.courseId,
    courseVersionId: source.response.courseVersionId, courseName: "Manuell bana", courseVersion: 1,
    snapshotVersionBefore: 2, snapshotVersionAfter: 3, request: firstRequest });
  const secondRequest = { ...firstRequest, requestId: randomUUID(), className: "H55", startRule: "FIXED" as const };
  const second = await createManualClassAsAdmin(db, { ...f.auth,
    idempotencyKey: `manual-class-create:${secondRequest.requestId}`, request: secondRequest }, now);
  expect(second.status).toBe("created");
  if (second.status !== "created") return;
  expect(second.response.classId).not.toBe(first.response.classId);
  expect(second.response.courseVersionId).toBe(first.response.courseVersionId);
  expect(await counts()).toEqual(before);
  expect((await pool.query("SELECT id,course_version_id,start_rule,external_source,external_id,max_entries,capacity_version FROM class WHERE id=ANY($1::uuid[]) ORDER BY start_rule",
    [[first.response.classId, second.response.classId]])).rows).toEqual([
    { id: second.response.classId, course_version_id: source.response.courseVersionId, start_rule: "FIXED",
      external_source: null, external_id: null, max_entries: null, capacity_version: 1 },
    { id: first.response.classId, course_version_id: source.response.courseVersionId, start_rule: "PUNCH",
      external_source: null, external_id: null, max_entries: null, capacity_version: 1 }
  ]);
  const replay = await createManualClassAsAdmin(db, { ...f.auth, idempotencyKey: firstKey, request: firstRequest }, now);
  expect(replay.status === "created" && replay.response.replayed).toBe(true);
  expect(replay.status === "created" && replay.response.classId).toBe(first.response.classId);
  expect((await createManualClassAsAdmin(db, { ...f.auth, idempotencyKey: firstKey,
    request: { ...firstRequest, className: "Ändrad" } }, now)).status).toBe("conflict");
  expect((await createManualClassAsAdmin(db, { ...f.auth,
    idempotencyKey: `manual-class-create:${randomUUID()}`, request: { ...firstRequest, requestId: randomUUID() } }, now)).status).toBe("invalid-request");
  // En ny förfrågan med samma klassnamn avvisas; versionen kontrolleras inte längre (steg 23).
  const sameName = { ...firstRequest, requestId: randomUUID() };
  expect((await createManualClassAsAdmin(db, { ...f.auth,
    idempotencyKey: `manual-class-create:${sameName.requestId}`, request: sameName }, now)).status).toBe("duplicate-name");
  const otherLogin = await raceLogin(db, f.raceId, "ADMIN", now);
  expect((await createManualClassAsAdmin(db, { raceId: f.raceId, sessionToken: otherLogin.sessionToken,
    csrfCookie: otherLogin.csrfToken, csrfHeader: otherLogin.csrfToken,
    idempotencyKey: firstKey, request: firstRequest }, now)).status).toBe("conflict");
  const foreign = await fixture();
  const foreignSource = await createManualCourseClassAsAdmin(db, { ...foreign.auth,
    idempotencyKey: foreign.key, request: foreign.request }, now);
  if (foreignSource.status !== "created") throw new Error("Synthetic foreign course not created");
  const wrongRace = { ...firstRequest, requestId: randomUUID(), courseVersionId: foreignSource.response.courseVersionId };
  expect((await createManualClassAsAdmin(db, { ...f.auth,
    idempotencyKey: `manual-class-create:${wrongRace.requestId}`, request: wrongRace }, now)).status).toBe("not-found");
  expect((await pool.query<{ snapshot_version: number }>("SELECT snapshot_version FROM race WHERE id=$1", [f.raceId])).rows[0]?.snapshot_version).toBe(4);
  expect(await counts()).toEqual(before);
  expect((await pool.query<{ count: string }>("SELECT count(*) FROM manual_class_create_request WHERE race_id=$1", [f.raceId])).rows[0]?.count).toBe("2");
  await expect(pool.query("UPDATE manual_class_create_request SET request=request WHERE request_id=$1", [firstRequest.requestId])).rejects.toThrow();
  await expect(pool.query("DELETE FROM manual_class_create_request WHERE request_id=$1", [firstRequest.requestId])).rejects.toThrow();
  const originalReplay = await createManualClassAsAdmin(db, { ...f.auth,
    idempotencyKey: firstKey, request: firstRequest }, now);
  expect(originalReplay.status).toBe("created");
  if (originalReplay.status !== "created") return;
  expect(originalReplay.response).toMatchObject({ classId: first.response.classId, request: firstRequest,
    replayed: true, snapshotVersionBefore: 2, snapshotVersionAfter: 3 });
  expect((await pool.query<{ name: string; course_version_id: string; capacity_version: number }>(
    "SELECT name,course_version_id,capacity_version FROM class WHERE id=$1", [first.response.classId])).rows[0])
    .toEqual({ name: "D40", course_version_id: source.response.courseVersionId, capacity_version: 1 });
});
