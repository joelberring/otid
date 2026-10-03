import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { getManualCourseResultImpactAsAdministrator } from "../../src/manual-course-result-impact";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { ingestDeviceBatch } from "../../src/ingest";
import { listResultApprovalCandidatesAsAdmin, approveResultAsAdmin } from "../../src/result-approval";
import { RESULT_APPROVAL_POLICY_VERSION } from "@o-tid/contracts";
import { contentHash } from "../../src/hash";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för en uttryckligen isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-19T14:00:00.000Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function login(raceId: string, capability: "MANAGE_RACE" | "APPROVE_RESULT") {
  const issued = await issuePairingAdminAccessCredential(db, { raceId, capability, label: `TASK083 ${capability}`,
    expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const result = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential },
    { expectedRaceId: raceId, expectedCapability: capability, now });
  if (result.status !== "authenticated") throw new Error("Synthetic login failed");
  return { raceId, sessionToken: result.sessionToken, csrfCookie: result.csrfToken, csrfHeader: result.csrfToken };
}

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK083','2026-09-19','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'TASK083','2026-09-19')", [raceId, eventId]);
  const manage = await login(raceId, "MANAGE_RACE");
  const request = { formatVersion: 1 as const, requestId: randomUUID(), expectedSnapshotVersion: 1,
    courseName: "Manuell", className: "Öppen", startRule: "PUNCH" as const, controlCodes: [31, 42] };
  const created = await createManualCourseClassAsAdministrator(db, { ...manage,
    idempotencyKey: `manual-course-class-create:${request.requestId}`, request }, now);
  if (created.status !== "created") throw new Error("Manual fixture failed");
  const firstEntryId = randomUUID(), secondEntryId = randomUUID();
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$2,$3,'Ada','Impact'),($4,$2,$3,'Bo','Impact')",
    [firstEntryId, raceId, created.response.classId, secondEntryId]);
  return { raceId, manage, firstEntryId, secondEntryId, created: created.response };
}

async function immutableCounts(raceId: string) {
  const result = await pool.query<{ snapshot: number; courses: string; classes: string; entries: string; results: string; audit: string; relinks: string }>(
    `SELECT (SELECT snapshot_version FROM race WHERE id=$1) AS snapshot,
      (SELECT count(*) FROM course WHERE race_id=$1) AS courses,
      (SELECT count(*) FROM class WHERE race_id=$1) AS classes,
      (SELECT count(*) FROM entry WHERE race_id=$1) AS entries,
      (SELECT count(*) FROM result_revision WHERE race_id=$1) AS results,
      (SELECT count(*) FROM audit_event WHERE race_id=$1) AS audit,
      (SELECT count(*) FROM manual_course_version_class_relink_request WHERE race_id=$1) AS relinks`, [raceId]);
  return result.rows[0];
}

it("TASK083 returns only latest headers and proves the impact read performs no writes", async () => {
  const f = await fixture();
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,'83001')", [f.raceId, f.firstEntryId]);
  const payload = { cardNumber: "83001", startPunchedAt: "2026-09-19T12:00:00Z", finishPunchedAt: "2026-09-19T12:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-19T12:05:00Z" }] };
  const deviceId = randomUUID();
  await ingestDeviceBatch(db, f.raceId, { deviceId, sessionId: deviceId, packageVersion: 2, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-09-19T12:21:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] });
  const approvalAuth = await login(f.raceId, "APPROVE_RESULT");
  const candidates = await listResultApprovalCandidatesAsAdmin(db, approvalAuth, now);
  if (candidates.status !== "ok") throw new Error("Approval candidate fixture failed");
  const candidate = candidates.response.entries.find(entry => entry.id === f.firstEntryId);
  if (!candidate || candidate.readiness !== "READY" || !candidate.targetResultRevision) throw new Error("Expected READY MP");
  const approved = await approveResultAsAdmin(db, { ...approvalAuth, entryId: f.firstEntryId,
    idempotencyKey: `manual-result-approval:${randomUUID()}`, request: { formatVersion: 1,
      expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId, expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: candidates.response.snapshotVersion, expectedResultRevision: {
        id: candidate.targetResultRevision.id, revision: candidate.targetResultRevision.revision,
        status: candidate.targetResultRevision.status, reason: candidate.targetResultRevision.reason },
      policyVersion: RESULT_APPROVAL_POLICY_VERSION } }, now);
  expect(approved.status).toBe("approved");
  const before = await immutableCounts(f.raceId);
  const impact = await getManualCourseResultImpactAsAdministrator(db, { ...f.manage, classId: f.created.classId }, now);
  expect(impact.status).toBe("ok");
  if (impact.status !== "ok") return;
  expect(impact.response).toMatchObject({ classId: f.created.classId, snapshotVersion: 2,
    course: { id: f.created.courseId, currentVersionId: f.created.courseVersionId, currentVersion: 1, controlCodes: [31, 42] },
    totals: { entryCount: 2, entriesWithResults: 1, historicalResultRevisions: 2 } });
  expect(impact.response.entries).toHaveLength(1);
  const latest = impact.response.entries[0];
  expect(latest?.entryId).toBe(f.firstEntryId);
  expect(latest?.displayName).toBe("Ada Impact");
  expect(latest?.latestResultRevision).toMatchObject({ revision: 2, status: "OK", courseVersionId: f.created.courseVersionId,
    snapshotVersion: 2, published: true, effectiveManualDecision: "APPROVAL" });
  expect(await immutableCounts(f.raceId)).toEqual(before);
});

it("TASK083 fails closed for imported scope and leaves no write behind", async () => {
  const f = await fixture();
  const before = await immutableCounts(f.raceId);
  await pool.query("UPDATE course SET external_source='IOF',external_id='course-083' WHERE id=$1", [f.created.courseId]);
  expect(await getManualCourseResultImpactAsAdministrator(db, { ...f.manage, classId: f.created.classId }, now)).toEqual({ status: "not-found" });
  await pool.query("UPDATE course SET external_source=NULL,external_id=NULL WHERE id=$1", [f.created.courseId]);
  expect(await getManualCourseResultImpactAsAdministrator(db, { ...f.manage, classId: randomUUID() }, now)).toEqual({ status: "not-found" });
  const otherRaceId = randomUUID(), otherEventId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK083 other','2026-09-19','Europe/Stockholm')", [otherEventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'TASK083 other','2026-09-19')", [otherRaceId, otherEventId]);
  expect(await getManualCourseResultImpactAsAdministrator(db, { ...f.manage, raceId: otherRaceId, classId: f.created.classId }, now)).toEqual({ status: "forbidden" });
  expect(await immutableCounts(f.raceId)).toEqual(before);
});
