import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { neutralizeClassControlAsAdministrator, previewClassControlNeutralizationAsAdministrator } from "../../src/class-control-neutralization";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { ingestDeviceBatch } from "../../src/ingest";
import { exportIofResultListAsAdmin } from "../../src/result-list-export";
import { listResultFinalizationCandidatesAsAdmin } from "../../src/result-finalization";
import { contentHash } from "../../src/hash";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för en uttryckligen isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-19T15:00:00.000Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK092','2026-09-19','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'TASK092','2026-09-19')", [raceId, eventId]);
  const issued = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "TASK092", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential }, { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  const auth = { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const exportIssued = await issuePairingAdminAccessCredential(db, { raceId, capability: "EXPORT_IOF_RESULT_LIST", label: "TASK092 export", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const exportLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: exportIssued.accessCredential }, { expectedRaceId: raceId, expectedCapability: "EXPORT_IOF_RESULT_LIST", now });
  if (exportLogin.status !== "authenticated") throw new Error("Synthetic export login failed");
  const exportAuth = { raceId, sessionToken: exportLogin.sessionToken };
  const finalIssued = await issuePairingAdminAccessCredential(db, { raceId, capability: "FINALIZE_RESULTS", label: "TASK092 final", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const finalLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: finalIssued.accessCredential }, { expectedRaceId: raceId, expectedCapability: "FINALIZE_RESULTS", now });
  if (finalLogin.status !== "authenticated") throw new Error("Synthetic finalization login failed");
  const finalAuth = { raceId, sessionToken: finalLogin.sessionToken };
  const createRequestId = randomUUID();
  const created = await createManualCourseClassAsAdministrator(db, { ...auth, idempotencyKey: `manual-course-class-create:${createRequestId}`,
    request: { formatVersion: 1, requestId: createRequestId, expectedSnapshotVersion: 1, courseName: "Manuell", className: "Öppen", startRule: "PUNCH", controlCodes: [31, 31, 42] } }, now);
  if (created.status !== "created") throw new Error("Fixture class failed");
  const entryId = randomUUID();
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$2,$3,'Ada','TASK092')", [entryId, raceId, created.response.classId]);
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,'92001')", [raceId, entryId]);
  const payload = { cardNumber: "92001", startPunchedAt: "2026-09-19T12:00:00Z", finishPunchedAt: "2026-09-19T12:20:00Z", punches: [
    { code: 31, punchedAt: "2026-09-19T12:05:00Z" }, { code: 42, punchedAt: "2026-09-19T12:10:00Z" }
  ] };
  await ingestDeviceBatch(db, raceId, { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: 2, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-09-19T12:21:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] });
  return { raceId, auth, exportAuth, finalAuth, entryId, created: created.response };
}

it("TASK092 journals one exact repeated-code occurrence, preserves history, and exactly replays", async () => {
  const f = await fixture();
  const candidate = await previewClassControlNeutralizationAsAdministrator(db, { ...f.auth, classId: f.created.classId }, now);
  expect(candidate.status).toBe("ok");
  if (candidate.status !== "ok") return;
  expect(candidate.response.controls.map((control) => [control.sequence, control.controlCode])).toEqual([[1, 31], [2, 31], [3, 42]]);
  const control = candidate.response.controls[0]!;
  const before = await pool.query("SELECT id,revision,evaluation FROM result_revision WHERE entry_id=$1", [f.entryId]);
  const request = { formatVersion: 1 as const, requestId: randomUUID(), expectedSnapshotVersion: candidate.response.snapshotVersion,
    expectedBasisHash: candidate.response.basisHash, classId: f.created.classId, expectedCourseVersionId: candidate.response.courseVersionId,
    courseControlId: control.id, sequence: control.sequence, controlCode: control.controlCode, acknowledgedNoAutomaticRecalculation: true as const };
  const changed = await neutralizeClassControlAsAdministrator(db, { ...f.auth, idempotencyKey: `class-control-neutralization:${request.requestId}`, request }, now);
  expect(changed.status).toBe("changed");
  if (changed.status !== "changed") return;
  expect(changed.response).toMatchObject({ courseControlId: control.id, sequence: 1, controlCode: 31, snapshotVersionAfter: candidate.response.snapshotVersion + 1 });
  expect((await pool.query("SELECT id,revision,evaluation FROM result_revision WHERE entry_id=$1", [f.entryId])).rows).toEqual(before.rows);
  expect((await pool.query<{ count: string }>("SELECT count(*) FROM class_control_neutralization WHERE id=$1", [request.requestId])).rows[0]?.count).toBe("1");
  const reevaluatedPayload = { cardNumber: "92001", startPunchedAt: "2026-09-19T12:00:00Z", finishPunchedAt: "2026-09-19T12:22:00Z", punches: [
    { code: 31, punchedAt: "2026-09-19T12:05:00Z" }, { code: 42, punchedAt: "2026-09-19T12:10:00Z" }
  ] };
  await ingestDeviceBatch(db, f.raceId, { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: changed.response.snapshotVersionAfter,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-19T12:23:00Z", transport: "simulator",
      payload: reevaluatedPayload, contentHash: contentHash(reevaluatedPayload) }] });
  expect((await pool.query<{ status: string; control_neutralization_id: string }>("SELECT status,control_neutralization_id FROM result_revision WHERE entry_id=$1 ORDER BY revision DESC LIMIT 1", [f.entryId])).rows[0])
    .toEqual({ status: "OK", control_neutralization_id: request.requestId });
  const exported = await exportIofResultListAsAdmin(db, f.exportAuth, now);
  expect(exported.status).toBe("ok");
  if (exported.status === "ok") expect(new TextDecoder().decode(exported.bytes)).toContain("<ControlCode>31</ControlCode>");
  const finalization = await listResultFinalizationCandidatesAsAdmin(db, f.finalAuth, now);
  expect(finalization.status).toBe("ok");
  if (finalization.status === "ok") {
    expect(finalization.response.classes.find((row) => row.classId === f.created.classId)?.blockerCodes)
      .toContain("INVALID_RESULT_REVISION");
  }
  expect(await neutralizeClassControlAsAdministrator(db, { ...f.auth, idempotencyKey: `class-control-neutralization:${request.requestId}`, request }, now))
    .toEqual({ status: "changed", response: { ...changed.response, replayed: true } });
  await expect(pool.query("UPDATE class_control_neutralization SET request=request WHERE id=$1", [request.requestId])).rejects.toThrow();
});

it("TASK092 rejects stale result basis without writing a neutralization", async () => {
  const f = await fixture();
  const candidate = await previewClassControlNeutralizationAsAdministrator(db, { ...f.auth, classId: f.created.classId }, now);
  if (candidate.status !== "ok") throw new Error("candidate missing");
  const payload = { cardNumber: "92001", startPunchedAt: "2026-09-19T12:00:00Z", finishPunchedAt: "2026-09-19T12:21:00Z", punches: [
    { code: 31, punchedAt: "2026-09-19T12:05:00Z" }, { code: 31, punchedAt: "2026-09-19T12:08:00Z" }, { code: 42, punchedAt: "2026-09-19T12:10:00Z" }
  ] };
  await ingestDeviceBatch(db, f.raceId, { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: candidate.response.snapshotVersion, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-09-19T12:22:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] });
  const control = candidate.response.controls[0]!, request = { formatVersion: 1 as const, requestId: randomUUID(),
    expectedSnapshotVersion: candidate.response.snapshotVersion, expectedBasisHash: candidate.response.basisHash,
    classId: f.created.classId, expectedCourseVersionId: candidate.response.courseVersionId, courseControlId: control.id,
    sequence: control.sequence, controlCode: control.controlCode, acknowledgedNoAutomaticRecalculation: true as const };
  expect((await neutralizeClassControlAsAdministrator(db, { ...f.auth,
    idempotencyKey: `class-control-neutralization:${request.requestId}`, request }, now)).status).toBe("conflict");
  expect((await pool.query<{ count: string }>("SELECT count(*) FROM class_control_neutralization WHERE race_id=$1", [f.raceId])).rows[0]?.count).toBe("0");
});
