import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import { contentHash } from "../../src/hash";
import { ingestDeviceBatch } from "../../src/ingest";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { listResultFinalizationCandidatesAsAdmin } from "../../src/result-finalization";
import {
  listUnknownReadoutResolutionCandidatesAsAdministrator,
  resolveUnknownReadoutAsAdministrator
} from "../../src/unknown-readout-resolution";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-19T14:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function auth(raceId: string, capability: "MANAGE_RACE" | "RECALCULATE_RESULT" = "MANAGE_RACE") {
  const installation = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Synthetic TASK085",
    expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential },
    { expectedRaceId: raceId, expectedCapability: capability, now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken,
    csrfHeader: login.csrfToken, actorId: installation.credentialId };
}

async function fixture(cardNumber = "85001") {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const classId = randomUUID(), entryId = randomUUID(), controlId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK085','2026-09-19','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'TASK085','2026-09-19')", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Course')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO control(id,race_id,code) VALUES($1,$2,31)", [controlId, raceId]);
  await pool.query("INSERT INTO course_control(course_version_id,control_id,sequence) VALUES($1,$2,1)", [courseVersionId, controlId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'Open',$3,'PUNCH')", [classId, raceId, courseVersionId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$2,$3,'Ada','Existing')", [entryId, raceId, classId]);
  const deviceId = randomUUID();
  const payloads = [
    { cardNumber, startPunchedAt: "2026-09-19T10:00:00Z", finishPunchedAt: "2026-09-19T10:20:00Z",
      punches: [{ code: 31, punchedAt: "2026-09-19T10:10:00Z" }] },
    { cardNumber, startPunchedAt: "2026-09-19T11:00:00Z", finishPunchedAt: "2026-09-19T11:40:00Z",
      punches: [{ code: 31, punchedAt: "2026-09-19T11:20:00Z" }] }
  ];
  const ingested = await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: 2, events: payloads.map((payload, index) => ({ localSequence: index + 1,
      stationReceivedAt: index === 0 ? "2026-09-19T10:21:00Z" : "2026-09-19T11:41:00Z",
      transport: "simulator" as const, payload, contentHash: contentHash(payload) })) });
  expect(ingested.acknowledgements.map((row) => row.status)).toEqual(["stored", "stored"]);
  return { raceId, classId, courseVersionId, entryId, cardNumber, administrator: await auth(raceId) };
}

async function immutableObservation(raceId: string) {
  const raw = (await pool.query("SELECT * FROM raw_device_message WHERE race_id=$1 ORDER BY local_sequence", [raceId])).rows;
  const readouts = (await pool.query("SELECT * FROM card_readout WHERE race_id=$1 ORDER BY read_at", [raceId])).rows;
  const outcomes = (await pool.query("SELECT o.* FROM device_ingest_outcome o JOIN raw_device_message r ON r.id=o.raw_message_id WHERE r.race_id=$1 ORDER BY r.local_sequence", [raceId])).rows;
  return JSON.stringify({ raw, readouts, outcomes });
}

describe("TASK085 atomic unknown readout resolution", () => {
  it("resolves the exact selected readout, replays exactly and preserves the original UNKNOWN_CARD observation", async () => {
    const f = await fixture();
    const listed = await listUnknownReadoutResolutionCandidatesAsAdministrator(db, f.administrator, now);
    if (listed.status !== "ok") throw new Error("Candidate read failed");
    expect(listed.response.readouts).toHaveLength(2);
    const selected = listed.response.readouts.find((row) => row.finishPunchedAt === "2026-09-19T10:20:00.000Z");
    if (!selected) throw new Error("Exact older readout missing");
    const before = await immutableObservation(f.raceId);
    const beforeFinalization = await listResultFinalizationCandidatesAsAdmin(db, f.administrator, now);
    if (beforeFinalization.status !== "ok") throw new Error("Finalization read failed");
    expect(beforeFinalization.response.race.unresolvedUnknownCardReadoutCount).toBe(2);
    const idempotencyKey = `unknown-readout-resolution:${randomUUID()}`;
    const request = { formatVersion: 1 as const, requestId: idempotencyKey.slice("unknown-readout-resolution:".length),
      target: "EXISTING_ENTRY" as const, readoutId: selected.id,
      cardNumber: f.cardNumber, expectedSnapshotVersion: listed.response.snapshotVersion,
      expectedEngineVersion: listed.response.engineVersion, entryId: f.entryId, expectedEntryVersion: 1,
      expectedClassId: f.classId, expectedAssignment: null, expectedLatestResultRevision: null };
    const first = await resolveUnknownReadoutAsAdministrator(db, { ...f.administrator, idempotencyKey, request }, now);
    if (first.status !== "resolved") throw new Error(`Resolution failed: ${first.status}`);
    expect(first.response).toMatchObject({ readoutId: selected.id, entryId: f.entryId, revision: 1,
      cause: "UNKNOWN_READOUT_RESOLUTION", snapshotVersionBefore: 1, snapshotVersionAfter: 2 });
    const result = (await pool.query<{ readout_id: string; evaluation: unknown; cause: string }>(
      "SELECT readout_id,evaluation,cause FROM result_revision WHERE id=$1", [first.response.resultRevisionId])).rows[0];
    expect(result).toMatchObject({ readout_id: selected.id, cause: "UNKNOWN_READOUT_RESOLUTION",
      evaluation: { startTime: "2026-09-19T10:00:00.000Z", finishTime: "2026-09-19T10:20:00.000Z" } });
    expect(await immutableObservation(f.raceId)).toBe(before);
    const afterFinalization = await listResultFinalizationCandidatesAsAdmin(db, f.administrator, now);
    if (afterFinalization.status !== "ok") throw new Error("Finalization read failed");
    expect(afterFinalization.response.race.unresolvedUnknownCardReadoutCount).toBe(1);
    expect(await resolveUnknownReadoutAsAdministrator(db, { ...f.administrator, idempotencyKey, request }, now))
      .toEqual({ status: "resolved", response: { ...first.response, replayed: true } });
    expect((await resolveUnknownReadoutAsAdministrator(db, { ...f.administrator, idempotencyKey,
      request: { ...request, readoutId: listed.response.readouts[0]!.id } }, now)).status).toBe("conflict");
    const staleRequestId = randomUUID();
    expect((await resolveUnknownReadoutAsAdministrator(db, { ...f.administrator,
      idempotencyKey: `unknown-readout-resolution:${staleRequestId}`,
      request: { ...request, requestId: staleRequestId } }, now)).status).toBe("conflict");
    expect((await pool.query("SELECT * FROM unknown_readout_resolution WHERE race_id=$1", [f.raceId])).rowCount).toBe(1);
    expect((await pool.query("SELECT * FROM result_revision WHERE race_id=$1", [f.raceId])).rowCount).toBe(1);
    await expect(pool.query("UPDATE unknown_readout_resolution SET resolved_at=resolved_at WHERE race_id=$1", [f.raceId])).rejects.toThrow();
  });

  it("direct-registers atomically with class capacity and rejects limited capability", async () => {
    const f = await fixture("85002"), limited = await auth(f.raceId, "RECALCULATE_RESULT");
    const listed = await listUnknownReadoutResolutionCandidatesAsAdministrator(db, f.administrator, now);
    if (listed.status !== "ok") throw new Error("Candidate read failed");
    expect((await listUnknownReadoutResolutionCandidatesAsAdministrator(db, limited, now)).status).toBe("forbidden");
    const selected = listed.response.readouts[0]!;
    const requestId = randomUUID();
    const request = { formatVersion: 1 as const, requestId, target: "NEW_ENTRY" as const, readoutId: selected.id,
      cardNumber: f.cardNumber, expectedSnapshotVersion: 1, expectedEngineVersion: listed.response.engineVersion,
      classId: f.classId, expectedCourseVersionId: f.courseVersionId, givenName: "Nya", familyName: "Löparen",
      organisationName: "Testklubben" };
    await pool.query("UPDATE class SET max_entries=1 WHERE id=$1", [f.classId]);
    expect((await resolveUnknownReadoutAsAdministrator(db, { ...f.administrator,
      idempotencyKey: `unknown-readout-resolution:${requestId}`, request }, now)).status).toBe("conflict");
    await pool.query("UPDATE class SET max_entries=2 WHERE id=$1", [f.classId]);
    const changed = await resolveUnknownReadoutAsAdministrator(db, { ...f.administrator,
      idempotencyKey: `unknown-readout-resolution:${requestId}`, request }, now);
    if (changed.status !== "resolved") throw new Error("Direct resolution failed");
    expect(changed.response).toMatchObject({ target: "NEW_ENTRY", entryVersion: 1, classId: f.classId,
      readoutId: selected.id, cardNumber: f.cardNumber });
    expect((await pool.query("SELECT e.given_name,e.family_name,a.card_number,a.active FROM entry e JOIN card_assignment a ON a.entry_id=e.id WHERE e.id=$1", [changed.response.entryId])).rows)
      .toEqual([{ given_name: "Nya", family_name: "Löparen", card_number: f.cardNumber, active: true }]);
    expect((await pool.query("SELECT action FROM audit_event WHERE request_id=$1", [changed.response.requestId])).rows)
      .toEqual([{ action: "UNKNOWN_READOUT_RESOLVED_BY_ADMIN" }]);
  });
});
