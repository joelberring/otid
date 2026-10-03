import { DID_NOT_START_DECISION_POLICY_VERSION } from "@o-tid/contracts";
import { decideDidNotStartAsAdmin } from "../../src/did-not-start";
import { withdrawDidNotStartAsAdmin } from "../../src/did-not-start-withdrawal";
import { decideWithoutTimingAsAdmin } from "../../src/without-timing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import { listResultRecalculationCandidatesAsAdmin, recalculateEntryAsAdmin } from "../../src/results";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";
import { disqualifyResultAsAdmin } from "../../src/result-disqualification";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/hash";
import { listEntryTransfersAsAdministrator } from "../../src/entry-transfer";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-12T14:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
async function auth(raceId: string, capability: "MANAGE_RACE" | "RECALCULATE_RESULT" | "DISQUALIFY_RESULT" | "VIEW_START_LIST" | "DECIDE_DID_NOT_START" | "WITHDRAW_DID_NOT_START" | "DECIDE_WITHOUT_TIMING" = "MANAGE_RACE") {
  const installation = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Synthetic recalculation",
    expiresAt: new Date(now.getTime() + 3600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential },
    { expectedRaceId: raceId, expectedCapability: capability, now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken, actorId: installation.credentialId };
}
async function fixture(withReadout = true) {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const classId = randomUUID(), entryId = randomUUID(), controlId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'Synthetic recalculation','2026-09-12','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'Synthetic recalculation','2026-09-12')", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Synthetic course')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO control(id,race_id,code) VALUES($1,$2,31)", [controlId, raceId]);
  await pool.query("INSERT INTO course_control(course_version_id,control_id,sequence) VALUES($1,$2,1)", [courseVersionId, controlId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'Synthetic class',$3,'PUNCH')", [classId, raceId, courseVersionId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$2,$3,'Ada','Synthetic')", [entryId, raceId, classId]);
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,'12345')", [raceId, entryId]);
  if (withReadout) {
  const payload = { cardNumber: "12345", startPunchedAt: "2026-09-12T10:00:00Z", finishPunchedAt: "2026-09-12T10:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-12T10:10:00Z" }] };
  const deviceId = randomUUID();
  const ingested = await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T10:21:00Z",
      transport: "simulator", payload, contentHash: contentHash(payload) }] });
  expect(ingested.acknowledgements[0]?.status).toBe("stored");
  }
  return { raceId, entryId, classId, courseVersionId, administrator: await auth(raceId) };
}
async function inputFor(actor: Awaited<ReturnType<typeof auth>>, entryId: string) {
  const listed = await listResultRecalculationCandidatesAsAdmin(db, actor, now);
  if (listed.status !== "ok") throw new Error("Candidate list failed");
  const entry = listed.response.entries.find((row) => row.id === entryId);
  if (!entry?.cardAssignmentId || !entry.latestReadout || !entry.latestResultRevision) throw new Error("Candidate missing");
  return { ...actor, entryId, idempotencyKey: `result-recalculation:${randomUUID()}`, request: {
    formatVersion: 1, expectedEntryVersion: entry.entryVersion, expectedClassId: entry.classId,
    expectedSnapshotVersion: listed.response.snapshotVersion, expectedCardAssignmentId: entry.cardAssignmentId,
    expectedReadoutId: entry.latestReadout.id, expectedLatestResultRevision: {
      id: entry.latestResultRevision.id, revision: entry.latestResultRevision.revision
    }, expectedEngineVersion: listed.response.engineVersion
  } };
}

async function read(f: Awaited<ReturnType<typeof fixture>>) {
  return getAdministratorEffectiveResult(db, { ...f.administrator, entryId: f.entryId }, now);
}
async function freshness(f: Awaited<ReturnType<typeof fixture>>) {
  const listed = await listEntryTransfersAsAdministrator(db, f.administrator, now);
  if (listed.status !== "ok") throw new Error("Roster freshness failed");
  const entry = listed.response.entries.find(row => row.id === f.entryId);
  if (!entry) throw new Error("Roster entry missing");
  return { freshness: entry.resultFreshness, effectiveResult: entry.effectiveResult };
}
async function footprint(raceId: string) {
  const results = (await pool.query("SELECT * FROM result_revision WHERE race_id=$1 ORDER BY revision", [raceId])).rows;
  const audit = (await pool.query("SELECT * FROM audit_event WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const raw = (await pool.query("SELECT * FROM raw_device_message WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const entries = (await pool.query("SELECT * FROM entry WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ results, audit, raw, entries });
}
describe("TASK033/TASK070 administrator effective result", () => {
  it("resolves DSQ above later technical results, preserves historical class and performs no writes", async () => {
    const f = await fixture(), official = await auth(f.raceId, "DISQUALIFY_RESULT");
    const initial = await inputFor(f.administrator, f.entryId);
    expect(await read(f)).toMatchObject({ status: "ok", response: { state: "ACTIVE_RESULT", governingDecision: "NONE", result: { status: "OK", revision: 1 } } });
    expect(await freshness(f)).toMatchObject({ freshness: "CURRENT_SNAPSHOT", effectiveResult: {
      state: "ACTIVE_RESULT", resultSnapshotVersion: 1, result: { status: "OK", revision: 1, elapsedMs: 1_200_000 } } });
    expect((await disqualifyResultAsAdmin(db, { ...official, entryId: f.entryId,
      idempotencyKey: `manual-disqualification:${randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: 1, expectedClassId: f.classId, expectedCourseVersionId: f.courseVersionId,
        expectedSnapshotVersion: 1, expectedResultRevision: { ...initial.request.expectedLatestResultRevision, status: "OK" },
        policyVersion: "manual-disqualification-v1" } }, now)).status).toBe("disqualified");
    expect((await recalculateEntryAsAdmin(db, await inputFor(f.administrator, f.entryId), now)).status).toBe("recalculated");
    const newClass = randomUUID();
    await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'Synthetic new class',$3,'PUNCH')", [newClass, f.raceId, f.courseVersionId]);
    await pool.query("UPDATE entry SET class_id=$1,version=2 WHERE id=$2", [newClass, f.entryId]);
    await pool.query("UPDATE race SET snapshot_version=2 WHERE id=$1", [f.raceId]);
    const before = await footprint(f.raceId);
    expect(await read(f)).toMatchObject({ status: "ok", response: { state: "ACTIVE_RESULT",
      currentClassId: newClass, entryVersion: 2, snapshotVersion: 2, resultSnapshotVersion: 1,
      selectedRevision: { revision: 3 }, result: { status: "DSQ", revision: 2 }, governingDecision: "DSQ",
      resultClass: { id: f.classId, name: "Synthetic class" }, generatedAt: now.toISOString() } });
    expect(await freshness(f)).toMatchObject({ freshness: "OLDER_SNAPSHOT", effectiveResult: {
      state: "ACTIVE_RESULT", selectedRevision: { revision: 3 }, resultSnapshotVersion: 1,
      result: { status: "DSQ", revision: 2 } } });
    expect(await footprint(f.raceId)).toBe(before);
  });

  it("distinguishes no published result, active DNS and withdrawn DNS while denying foreign entries and limited roles", async () => {
    const f = await fixture(false), other = await fixture(false), reader = await auth(f.raceId, "VIEW_START_LIST");
    expect(await read(f)).toMatchObject({ status: "ok", response: { state: "NO_PUBLISHED_RESULT", selectedRevision: null } });
    expect(await freshness(f)).toEqual({ freshness: "NO_PUBLISHED_RESULT", effectiveResult: {
      state: "NO_PUBLISHED_RESULT", selectedRevision: null } });
    expect((await getAdministratorEffectiveResult(db, { ...reader, entryId: f.entryId }, now)).status).toBe("forbidden");
    expect((await getAdministratorEffectiveResult(db, { ...f.administrator, entryId: other.entryId }, now)).status).toBe("not-found");
    const official = await auth(f.raceId, "DECIDE_DID_NOT_START");
    const base = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: f.classId,
      expectedCourseVersionId: f.courseVersionId, expectedSnapshotVersion: 1 };
    const dns = await decideDidNotStartAsAdmin(db, { ...official, entryId: f.entryId,
      idempotencyKey: `did-not-start:${randomUUID()}`, request: { ...base, expectedLatestResultRevision: null,
        policyVersion: DID_NOT_START_DECISION_POLICY_VERSION } }, now);
    if (dns.status !== "decided") throw new Error("Synthetic DNS failed");
    expect(await read(f)).toMatchObject({ status: "ok", response: { state: "ACTIVE_RESULT", governingDecision: "DNS", result: { status: "DNS" } } });
    expect(await freshness(f)).toMatchObject({ freshness: "CURRENT_SNAPSHOT", effectiveResult: {
      state: "ACTIVE_RESULT", result: { status: "DNS" } } });
    const withdrawing = await auth(f.raceId, "WITHDRAW_DID_NOT_START");
    expect((await withdrawDidNotStartAsAdmin(db, { ...withdrawing, entryId: f.entryId,
      idempotencyKey: `did-not-start-withdrawal:${randomUUID()}`, request: { ...base,
        expectedDidNotStartDecisionId: dns.response.didNotStartDecisionId,
        expectedResultRevision: { id: dns.response.resultRevisionId, revision: dns.response.revision },
        policyVersion: "did-not-start-withdrawal-v1" } }, now)).status).toBe("withdrawn");
    const before = await footprint(f.raceId);
    expect(await read(f)).toMatchObject({ status: "ok", response: { state: "NO_ACTIVE_RESULT",
      selectedRevision: { id: dns.response.resultRevisionId, revision: 1 } } });
    expect(await freshness(f)).toEqual({ freshness: "NO_ACTIVE_RESULT", effectiveResult: {
      state: "NO_ACTIVE_RESULT", selectedRevision: { id: dns.response.resultRevisionId, revision: 1 } } });
    expect(await footprint(f.raceId)).toBe(before);
  });

  it("projects without timing without an elapsed time", async () => {
    const f = await fixture(), official = await auth(f.raceId, "DECIDE_WITHOUT_TIMING");
    const initial = await inputFor(f.administrator, f.entryId);
    expect((await decideWithoutTimingAsAdmin(db, { ...official, entryId: f.entryId,
      idempotencyKey: `without-timing:${randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: 1, expectedClassId: f.classId, expectedCourseVersionId: f.courseVersionId,
        expectedSnapshotVersion: 1, expectedResultRevision: { ...initial.request.expectedLatestResultRevision, status: "OK", reason: "COMPLETE" },
        policyVersion: "without-timing-v1" } }, now)).status).toBe("without-timing");
    const before = await footprint(f.raceId), result = await read(f);
    expect(result).toMatchObject({ status: "ok", response: { state: "ACTIVE_RESULT",
      governingDecision: "NT", result: { status: "NT", revision: 2 } } });
    if (result.status !== "ok" || result.response.state !== "ACTIVE_RESULT") throw new Error("Missing result");
    expect(result.response.result).not.toHaveProperty("elapsedMs");
    const listed = await freshness(f);
    expect(listed).toMatchObject({ freshness: "CURRENT_SNAPSHOT", effectiveResult: {
      state: "ACTIVE_RESULT", result: { status: "NT", revision: 2 } } });
    if (listed.effectiveResult.state !== "ACTIVE_RESULT") throw new Error("Missing roster result");
    expect(listed.effectiveResult.result).not.toHaveProperty("elapsedMs");
    expect(await footprint(f.raceId)).toBe(before);
  });
});
