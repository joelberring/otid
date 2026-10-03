import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { createManualClassAsAdministrator } from "../../src/manual-class";
import { listManualClassNameAsAdministrator, changeManualClassNameAsAdministrator } from "../../src/manual-class-name";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { importIofXml } from "../../src/import-iof";

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
  const issued = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "TASK081",
    expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential }, { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  const auth = { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const request = { formatVersion: 1 as const, requestId: randomUUID(), expectedSnapshotVersion: 1,
    courseName: "Manuell bana", className: "Öppen", startRule: "PUNCH" as const, controlCodes: [31, 42, 31] };
  return { raceId, auth, request, key: `manual-course-class-create:${request.requestId}` };
}

it("TASK081 creates an ordered manual course/class once and protects its history", async () => {
  const f = await fixture();
  const created = await createManualCourseClassAsAdministrator(db, { ...f.auth, idempotencyKey: f.key, request: f.request }, now);
  expect(created.status).toBe("created");
  if (created.status !== "created") return;
  expect(created.response).toMatchObject({ snapshotVersionBefore: 1, snapshotVersionAfter: 2, request: f.request });
  expect((await pool.query("SELECT external_source,external_id,start_rule,max_entries,capacity_version FROM class WHERE id=$1", [created.response.classId])).rows[0])
    .toEqual({ external_source: null, external_id: null, start_rule: "PUNCH", max_entries: null, capacity_version: 1 });
  expect((await pool.query<{ code: number }>("SELECT c.code FROM course_control cc JOIN control c ON c.id=cc.control_id WHERE cc.course_version_id=$1 ORDER BY cc.sequence", [created.response.courseVersionId])).rows.map(row => row.code)).toEqual([31, 42, 31]);
  const replay = await createManualCourseClassAsAdministrator(db, { ...f.auth, idempotencyKey: f.key, request: f.request }, now);
  expect(replay.status === "created" && replay.response.replayed).toBe(true);
  const otherIssued = await issuePairingAdminAccessCredential(db, { raceId: f.raceId, capability: "MANAGE_RACE", label: "Other TASK081 admin",
    expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const otherLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: otherIssued.accessCredential },
    { expectedRaceId: f.raceId, expectedCapability: "MANAGE_RACE", now });
  if (otherLogin.status !== "authenticated") throw new Error("Synthetic second login failed");
  expect((await createManualCourseClassAsAdministrator(db, { raceId: f.raceId, sessionToken: otherLogin.sessionToken,
    csrfCookie: otherLogin.csrfToken, csrfHeader: otherLogin.csrfToken, idempotencyKey: f.key, request: f.request }, now)).status).toBe("conflict");
  expect((await pool.query<{ snapshot_version: number }>("SELECT snapshot_version FROM race WHERE id=$1", [f.raceId])).rows[0]?.snapshot_version).toBe(2);
  await expect(pool.query("UPDATE course_control SET sequence=sequence WHERE course_version_id=$1", [created.response.courseVersionId])).rejects.toThrow();
  await expect(pool.query("UPDATE manual_course_class_create_request SET request=request WHERE request_id=$1", [f.request.requestId])).rejects.toThrow();
  await expect(pool.query("DELETE FROM manual_course_class_create_request WHERE request_id=$1", [f.request.requestId])).rejects.toThrow();
  await expect(pool.query("DELETE FROM course_control WHERE course_version_id=$1", [created.response.courseVersionId])).rejects.toThrow();
  expect((await createManualCourseClassAsAdministrator(db, { ...f.auth, idempotencyKey: f.key,
    request: { ...f.request, className: "Ändrad" } }, now)).status).toBe("conflict");
});

it("TASK081 rolls back stale requests", async () => {
  const f = await fixture();
  const result = await createManualCourseClassAsAdministrator(db, { ...f.auth, idempotencyKey: f.key, request: { ...f.request, expectedSnapshotVersion: 2 } }, now);
  expect(result.status).toBe("conflict");
  expect((await pool.query<{ count: string }>("SELECT count(*) FROM course WHERE race_id=$1", [f.raceId])).rows[0]?.count).toBe("0");
});

it("TASK081 preserves manual objects across IOF import and rejects a limited credential", async () => {
  const f = await fixture();
  const limitedIssued = await issuePairingAdminAccessCredential(db, { raceId: f.raceId, capability: "CHANGE_ENTRY_CLASS", label: "Limited",
    expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const limitedLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: limitedIssued.accessCredential }, { expectedRaceId: f.raceId, expectedCapability: "CHANGE_ENTRY_CLASS", now });
  if (limitedLogin.status !== "authenticated") throw new Error("Synthetic limited login failed");
  expect((await createManualCourseClassAsAdministrator(db, { raceId: f.raceId, sessionToken: limitedLogin.sessionToken,
    csrfCookie: limitedLogin.csrfToken, csrfHeader: limitedLogin.csrfToken, idempotencyKey: f.key, request: f.request }, now)).status).toBe("forbidden");
  const xml = await readFile(new URL("../../../../fixtures/iof/course-data.xml", import.meta.url), "utf8");
  await importIofXml(db, f.raceId, xml);
  const created = await createManualCourseClassAsAdministrator(db, { ...f.auth, idempotencyKey: f.key,
    request: { ...f.request, expectedSnapshotVersion: 2 } }, now);
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
  const snapshotVersion = (await pool.query<{ snapshot_version: number }>(
    "SELECT snapshot_version FROM race WHERE id=$1", [f.raceId])).rows[0]!.snapshot_version;
  const importedRequest = { formatVersion: 1 as const, requestId: randomUUID(), expectedSnapshotVersion: snapshotVersion,
    courseVersionId: imported.course_version_id, className: "Manuell klass på IOF-bana", startRule: "FIXED" as const };
  const importedClass = await createManualClassAsAdministrator(db, { ...f.auth,
    idempotencyKey: `manual-class-create:${importedRequest.requestId}`, request: importedRequest }, now);
  expect(importedClass.status).toBe("created");
  if (importedClass.status !== "created") return;
  expect((await pool.query("SELECT external_source,external_id,course_version_id FROM class WHERE id=$1", [importedClass.response.classId])).rows[0])
    .toEqual({ external_source: null, external_id: null, course_version_id: imported.course_version_id });
});

it("TASK300 adds two manual classes to one exact version without copying its course or controls", async () => {
  const f = await fixture();
  const source = await createManualCourseClassAsAdministrator(db, { ...f.auth, idempotencyKey: f.key, request: f.request }, now);
  if (source.status !== "created") throw new Error("Synthetic source course not created");
  const counts = async () => (await pool.query<{ courses: string; versions: string; controls: string }>(
    "SELECT (SELECT count(*) FROM course WHERE race_id=$1) AS courses, " +
    "(SELECT count(*) FROM course_version WHERE course_id=$2) AS versions, " +
    "(SELECT count(*) FROM course_control WHERE course_version_id=$3) AS controls",
    [f.raceId, source.response.courseId, source.response.courseVersionId])).rows[0];
  const before = await counts();
  const firstRequest = { formatVersion: 1 as const, requestId: randomUUID(), expectedSnapshotVersion: 2,
    courseVersionId: source.response.courseVersionId, className: "D40", startRule: "PUNCH" as const };
  const firstKey = `manual-class-create:${firstRequest.requestId}`;
  const first = await createManualClassAsAdministrator(db, { ...f.auth, idempotencyKey: firstKey, request: firstRequest }, now);
  expect(first.status).toBe("created");
  if (first.status !== "created") return;
  expect(first.response).toMatchObject({ courseId: source.response.courseId,
    courseVersionId: source.response.courseVersionId, courseName: "Manuell bana", courseVersion: 1,
    snapshotVersionBefore: 2, snapshotVersionAfter: 3, request: firstRequest });
  const secondRequest = { ...firstRequest, requestId: randomUUID(), expectedSnapshotVersion: 3,
    className: "H55", startRule: "FIXED" as const };
  const second = await createManualClassAsAdministrator(db, { ...f.auth,
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
  const replay = await createManualClassAsAdministrator(db, { ...f.auth, idempotencyKey: firstKey, request: firstRequest }, now);
  expect(replay.status === "created" && replay.response.replayed).toBe(true);
  expect(replay.status === "created" && replay.response.classId).toBe(first.response.classId);
  expect((await createManualClassAsAdministrator(db, { ...f.auth, idempotencyKey: firstKey,
    request: { ...firstRequest, className: "Ändrad" } }, now)).status).toBe("conflict");
  expect((await createManualClassAsAdministrator(db, { ...f.auth,
    idempotencyKey: `manual-class-create:${randomUUID()}`, request: { ...firstRequest, requestId: randomUUID() } }, now)).status).toBe("invalid-request");
  const stale = { ...firstRequest, requestId: randomUUID(), expectedSnapshotVersion: 2 };
  expect((await createManualClassAsAdministrator(db, { ...f.auth,
    idempotencyKey: `manual-class-create:${stale.requestId}`, request: stale }, now)).status).toBe("conflict");
  const otherIssued = await issuePairingAdminAccessCredential(db, { raceId: f.raceId, capability: "MANAGE_RACE", label: "TASK300 second actor",
    expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const otherLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: otherIssued.accessCredential },
    { expectedRaceId: f.raceId, expectedCapability: "MANAGE_RACE", now });
  if (otherLogin.status !== "authenticated") throw new Error("Synthetic second login failed");
  expect((await createManualClassAsAdministrator(db, { raceId: f.raceId, sessionToken: otherLogin.sessionToken,
    csrfCookie: otherLogin.csrfToken, csrfHeader: otherLogin.csrfToken,
    idempotencyKey: firstKey, request: firstRequest }, now)).status).toBe("conflict");
  const foreign = await fixture();
  const foreignSource = await createManualCourseClassAsAdministrator(db, { ...foreign.auth,
    idempotencyKey: foreign.key, request: foreign.request }, now);
  if (foreignSource.status !== "created") throw new Error("Synthetic foreign course not created");
  const wrongRace = { ...firstRequest, requestId: randomUUID(), expectedSnapshotVersion: 4,
    courseVersionId: foreignSource.response.courseVersionId };
  expect((await createManualClassAsAdministrator(db, { ...f.auth,
    idempotencyKey: `manual-class-create:${wrongRace.requestId}`, request: wrongRace }, now)).status).toBe("not-found");
  expect((await pool.query<{ snapshot_version: number }>("SELECT snapshot_version FROM race WHERE id=$1", [f.raceId])).rows[0]?.snapshot_version).toBe(4);
  expect(await counts()).toEqual(before);
  expect((await pool.query<{ count: string }>("SELECT count(*) FROM manual_class_create_request WHERE race_id=$1", [f.raceId])).rows[0]?.count).toBe("2");
  await expect(pool.query("UPDATE manual_class_create_request SET request=request WHERE request_id=$1", [firstRequest.requestId])).rejects.toThrow();
  await expect(pool.query("DELETE FROM manual_class_create_request WHERE request_id=$1", [firstRequest.requestId])).rejects.toThrow();
  const candidate = await listManualClassNameAsAdministrator(db, { ...f.auth, classId: first.response.classId }, now);
  expect(candidate.status === "ok" && candidate.response).toMatchObject({ snapshotVersion: 4,
    classId: first.response.classId, className: "D40", courseVersionId: source.response.courseVersionId, editable: true });
  const nameRequest = { formatVersion: 1 as const, requestId: randomUUID(), expectedSnapshotVersion: 4,
    expectedClassName: "D40", className: "Damer 40" };
  const nameKey = `manual-class-name:${nameRequest.requestId}`;
  const changed = await changeManualClassNameAsAdministrator(db, { ...f.auth,
    classId: first.response.classId, idempotencyKey: nameKey, request: nameRequest }, now);
  expect(changed.status).toBe("changed");
  if (changed.status !== "changed") return;
  expect(changed.response).toMatchObject({ previousClassName: "D40", className: "Damer 40",
    courseVersionId: source.response.courseVersionId, snapshotVersionBefore: 4, snapshotVersionAfter: 5 });
  const nameReplay = await changeManualClassNameAsAdministrator(db, { ...f.auth,
    classId: first.response.classId, idempotencyKey: nameKey, request: nameRequest }, now);
  expect(nameReplay.status === "changed" && nameReplay.response.replayed).toBe(true);
  const originalReplay = await createManualClassAsAdministrator(db, { ...f.auth,
    idempotencyKey: firstKey, request: firstRequest }, now);
  expect(originalReplay.status).toBe("created");
  if (originalReplay.status !== "created") return;
  expect(originalReplay.response).toMatchObject({ classId: first.response.classId, request: firstRequest,
    replayed: true, snapshotVersionBefore: 2, snapshotVersionAfter: 3 });
  const staleName = { ...nameRequest, requestId: randomUUID() };
  expect((await changeManualClassNameAsAdministrator(db, { ...f.auth, classId: first.response.classId,
    idempotencyKey: `manual-class-name:${staleName.requestId}`, request: staleName }, now)).status).toBe("conflict");
  const noOpName = { ...nameRequest, requestId: randomUUID(), expectedSnapshotVersion: 5,
    expectedClassName: "Damer 40" };
  expect((await changeManualClassNameAsAdministrator(db, { ...f.auth, classId: first.response.classId,
    idempotencyKey: `manual-class-name:${noOpName.requestId}`, request: noOpName }, now)).status).toBe("conflict");
  expect((await changeManualClassNameAsAdministrator(db, { raceId: f.raceId, classId: first.response.classId,
    sessionToken: otherLogin.sessionToken, csrfCookie: otherLogin.csrfToken, csrfHeader: otherLogin.csrfToken,
    idempotencyKey: nameKey, request: nameRequest }, now)).status).toBe("conflict");
  expect((await changeManualClassNameAsAdministrator(db, { ...f.auth, classId: second.response.classId,
    idempotencyKey: nameKey, request: nameRequest }, now)).status).toBe("conflict");
  expect((await pool.query<{ name: string; course_version_id: string; capacity_version: number }>(
    "SELECT name,course_version_id,capacity_version FROM class WHERE id=$1", [first.response.classId])).rows[0])
    .toEqual({ name: "Damer 40", course_version_id: source.response.courseVersionId, capacity_version: 1 });
  await expect(pool.query("UPDATE manual_class_name_change_request SET request=request WHERE request_id=$1", [nameRequest.requestId])).rejects.toThrow();
  await expect(pool.query("DELETE FROM manual_class_name_change_request WHERE request_id=$1", [nameRequest.requestId])).rejects.toThrow();
  const xml = await readFile(new URL("../../../../fixtures/iof/course-data.xml", import.meta.url), "utf8");
  await importIofXml(db, f.raceId, xml);
  const importedClass = (await pool.query<{ id: string; name: string }>(
    "SELECT id,name FROM class WHERE race_id=$1 AND external_source='iof' ORDER BY id LIMIT 1", [f.raceId])).rows[0];
  if (!importedClass) throw new Error("Synthetic IOF class missing");
  const importedCandidate = await listManualClassNameAsAdministrator(db, { ...f.auth, classId: importedClass.id }, now);
  expect(importedCandidate.status === "ok" && importedCandidate.response.editable).toBe(false);
  const importedSnapshot = (await pool.query<{ snapshot_version: number }>(
    "SELECT snapshot_version FROM race WHERE id=$1", [f.raceId])).rows[0]!.snapshot_version;
  const importedName = { formatVersion: 1 as const, requestId: randomUUID(), expectedSnapshotVersion: importedSnapshot,
    expectedClassName: importedClass.name, className: "Importerad rättning" };
  expect((await changeManualClassNameAsAdministrator(db, { ...f.auth, classId: importedClass.id,
    idempotencyKey: `manual-class-name:${importedName.requestId}`, request: importedName }, now)).status).toBe("conflict");
});
