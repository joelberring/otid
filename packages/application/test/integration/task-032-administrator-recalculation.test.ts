import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import { listResultRecalculationCandidatesAsAdmin, recalculateEntryAsAdmin, publicResults } from "../../src/results";
import { disqualifyResultAsAdmin } from "../../src/result-disqualification";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/hash";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-12T14:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
async function auth(raceId: string, capability: "MANAGE_RACE" | "RECALCULATE_RESULT" | "DISQUALIFY_RESULT" | "VIEW_START_LIST" = "MANAGE_RACE") {
  const installation = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Synthetic recalculation",
    expiresAt: new Date(now.getTime() + 3600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential },
    { expectedRaceId: raceId, expectedCapability: capability, now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken, actorId: installation.credentialId };
}
async function fixture() {
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
  const payload = { cardNumber: "12345", startPunchedAt: "2026-09-12T10:00:00Z", finishPunchedAt: "2026-09-12T10:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-12T10:10:00Z" }] };
  const deviceId = randomUUID();
  const ingested = await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T10:21:00Z",
      transport: "simulator", payload, contentHash: contentHash(payload) }] });
  expect(ingested.acknowledgements[0]?.status).toBe("stored");
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
async function preserved(raceId: string) {
  const entry = (await pool.query("SELECT * FROM entry WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const race = (await pool.query("SELECT * FROM race WHERE id=$1", [raceId])).rows;
  const raw = (await pool.query("SELECT * FROM raw_device_message WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const readouts = (await pool.query("SELECT * FROM card_readout WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const cards = (await pool.query("SELECT * FROM card_assignment WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const decisions = (await pool.query("SELECT * FROM result_disqualification_decision WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ entry, race, raw, readouts, cards, decisions });
}

describe("TASK032 administrator explicit recalculation", () => {
  it("retains real actors, historical exact retry and manual disqualification over new published technical revisions", async () => {
    const f = await fixture(), limited = await auth(f.raceId, "RECALCULATE_RESULT"), official = await auth(f.raceId, "DISQUALIFY_RESULT");
    const initial = await inputFor(f.administrator, f.entryId);
    const decision = await disqualifyResultAsAdmin(db, { ...official, entryId: f.entryId,
      idempotencyKey: `manual-disqualification:${randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: 1, expectedClassId: f.classId, expectedCourseVersionId: f.courseVersionId,
        expectedSnapshotVersion: 1, expectedResultRevision: { ...initial.request.expectedLatestResultRevision, status: "OK" },
        policyVersion: "manual-disqualification-v1" } }, now);
    expect(decision.status).toBe("disqualified");
    const original = await preserved(f.raceId);
    const oldRevisions = (await pool.query("SELECT * FROM result_revision WHERE race_id=$1 ORDER BY revision", [f.raceId])).rows;
    const input = await inputFor(f.administrator, f.entryId);
    const changed = await recalculateEntryAsAdmin(db, input, now);
    if (changed.status !== "recalculated") throw new Error("Recalculation failed");
    expect(changed.response).toMatchObject({ revision: 3, status: "OK", cause: "EXPLICIT_RECALCULATION", snapshotVersion: 1,
      readoutId: input.request.expectedReadoutId, engineVersion: input.request.expectedEngineVersion });
    expect((await recalculateEntryAsAdmin(db, await inputFor(limited, f.entryId), now)).status).toBe("recalculated");
    expect(await recalculateEntryAsAdmin(db, input, now)).toEqual({ status: "recalculated", response: { ...changed.response, replayed: true } });
    expect((await recalculateEntryAsAdmin(db, { ...input, ...limited }, now)).status).toBe("conflict");
    expect(await preserved(f.raceId)).toBe(original);
    const revisions = (await pool.query("SELECT * FROM result_revision WHERE race_id=$1 ORDER BY revision", [f.raceId])).rows;
    expect(revisions).toHaveLength(4); expect(revisions.slice(0, 2)).toEqual(oldRevisions);
    expect(revisions.slice(2)).toEqual(expect.arrayContaining([expect.objectContaining({ published: true, cause: "EXPLICIT_RECALCULATION" })]));
    expect((await publicResults(db, f.raceId)).results).toMatchObject([{ status: "DSQ", revision: 2 }]);
    const audits = (await pool.query("SELECT actor_kind,actor_id FROM audit_event WHERE race_id=$1 AND action='RESULT_RECALCULATED_BY_ADMIN' ORDER BY actor_kind::text", [f.raceId])).rows;
    expect(audits).toEqual([{ actor_kind: "RACE_ADMIN_ACCESS_CREDENTIAL", actor_id: f.administrator.actorId },
      { actor_kind: "RESULT_RECALCULATION_ACCESS_CREDENTIAL", actor_id: limited.actorId }]);
    expect((await pool.query("SELECT * FROM result_recalculation_request WHERE race_id=$1", [f.raceId])).rowCount).toBe(2);
    await expect(pool.query("UPDATE result_recalculation_request SET recalculated_at=recalculated_at WHERE race_id=$1", [f.raceId])).rejects.toThrow();
  });

  it("rejects missing CSRF, limited readers and stale or changed intents without new revisions", async () => {
    const f = await fixture(), reader = await auth(f.raceId, "VIEW_START_LIST");
    const input = await inputFor(f.administrator, f.entryId), before = await preserved(f.raceId);
    expect((await recalculateEntryAsAdmin(db, { ...input, csrfHeader: null }, now)).status).toBe("forbidden");
    expect((await recalculateEntryAsAdmin(db, { ...input, ...reader }, now)).status).toBe("forbidden");
    expect((await listResultRecalculationCandidatesAsAdmin(db, reader, now)).status).toBe("forbidden");
    for (const patch of [{ expectedEntryVersion: 2 }, { expectedSnapshotVersion: 2 }, { expectedReadoutId: randomUUID() },
      { expectedCardAssignmentId: randomUUID() }, { expectedLatestResultRevision: null }]) {
      expect((await recalculateEntryAsAdmin(db, { ...input, request: { ...input.request, ...patch } }, now)).status).toBe("conflict");
    }
    expect((await recalculateEntryAsAdmin(db, input, now)).status).toBe("recalculated");
    expect((await recalculateEntryAsAdmin(db, { ...input, request: { ...input.request, expectedEntryVersion: 2 } }, now)).status).toBe("conflict");
    expect((await recalculateEntryAsAdmin(db, { ...input, idempotencyKey: `result-recalculation:${randomUUID()}` }, now)).status).toBe("conflict");
    expect((await pool.query("SELECT * FROM result_revision WHERE race_id=$1", [f.raceId])).rowCount).toBe(2);
    expect((await pool.query("SELECT * FROM result_recalculation_request WHERE race_id=$1", [f.raceId])).rowCount).toBe(1);
    expect(await preserved(f.raceId)).toBe(before);
  });
});
