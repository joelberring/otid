import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import type { EntryTransferRequest } from "@o-tid/contracts";
import { listEntryTransfersAsAdministrator, transferEntryAsAdministrator } from "../../src/entry-transfer";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/hash";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för en uttryckligen isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-12T10:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function auth(raceId: string, capability: "MANAGE_RACE" | "CHANGE_ENTRY_CLASS" = "MANAGE_RACE") {
  const installation = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Synthetic transfer",
    expiresAt: new Date(now.getTime() + 3600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential },
    { expectedRaceId: raceId, expectedCapability: capability, now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
}
async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const punchId = randomUUID(), fixedId = randomUUID(), entryId = randomUUID(), otherEntryId = randomUUID(), controlId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'Synthetic transfer','2026-09-12','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'Synthetic transfer','2026-09-12')", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Synthetic course')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO control(id,race_id,code) VALUES($1,$2,31)", [controlId, raceId]);
  await pool.query("INSERT INTO course_control(course_version_id,control_id,sequence) VALUES($1,$2,1)", [courseVersionId, controlId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$3,'Fri klass',$4,'PUNCH'),($2,$3,'Fast klass',$4,'FIXED')",
    [punchId, fixedId, raceId, courseVersionId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name,organisation_name) VALUES($1,$3,$4,'Ada','Test','Syntetisk OK'),($2,$3,$4,'Bo','Test',null)",
    [entryId, otherEntryId, raceId, punchId]);
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,'12345')", [raceId, entryId]);
  const actor = await auth(raceId);
  const request: EntryTransferRequest = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: punchId,
    expectedSnapshotVersion: 1, expectedFixedStartTime: null, targetClassId: fixedId,
    expectedTargetCourseVersionId: courseVersionId, expectedTargetStartRule: "FIXED", fixedStartTime: "2026-09-12T12:03:04.125+02:00" };
  return { raceId, entryId, otherEntryId, punchId, fixedId, courseVersionId, actor, request };
}
async function state(raceId: string) {
  const entries = (await pool.query("SELECT * FROM entry WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const races = (await pool.query("SELECT * FROM race WHERE id=$1", [raceId])).rows;
  const journal = (await pool.query("SELECT * FROM entry_transfer_request WHERE race_id=$1 ORDER BY request_id", [raceId])).rows;
  const audit = (await pool.query("SELECT * FROM audit_event WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ entries, races, journal, audit });
}
async function preserved(raceId: string) {
  const raw = (await pool.query("SELECT * FROM raw_device_message WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const readouts = (await pool.query("SELECT * FROM card_readout WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const results = (await pool.query("SELECT * FROM result_revision WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const cards = (await pool.query("SELECT * FROM card_assignment WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ raw, readouts, results, cards });
}

describe("TASK029 atomic class and fixed-start transfer, real PostgreSQL", () => {
  it("moves PUNCH → FIXED → PUNCH, preserves actual readout/result/card history and replays exact original intent", async () => {
    const f = await fixture(), key = `entry-transfer:${randomUUID()}`;
    const payload = { cardNumber: "12345", startPunchedAt: "2026-09-12T10:00:00Z", finishPunchedAt: "2026-09-12T10:20:00Z",
      punches: [{ code: 31, punchedAt: "2026-09-12T10:10:00Z" }] };
    const deviceId = randomUUID();
    const ingested = await ingestDeviceBatch(db, f.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
      firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T10:21:00Z",
        transport: "simulator", payload, contentHash: contentHash(payload) }] });
    expect(ingested.acknowledgements[0]?.status).toBe("stored");
    const original = await preserved(f.raceId);
    const list = await listEntryTransfersAsAdministrator(db, f.actor, now);
    if (list.status !== "ok") throw new Error("No candidate list");
    expect(list.response).toMatchObject({ raceDate: "2026-09-12", timeZone: "Europe/Stockholm", snapshotVersion: 1 });
    expect(list.response.entries).toHaveLength(2);
    const changed = await transferEntryAsAdministrator(db, { ...f.actor, entryId: f.entryId, idempotencyKey: key, request: f.request }, now);
    if (changed.status !== "transferred") throw new Error("Transfer failed");
    expect(changed.response.request.fixedStartTime).toBe("2026-09-12T10:03:04.125Z");
    expect(changed.response).toMatchObject({ entryVersionAfter: 2, snapshotVersionAfter: 2, replayed: false });
    const back: EntryTransferRequest = { ...f.request, expectedEntryVersion: 2, expectedClassId: f.fixedId, expectedSnapshotVersion: 2,
      expectedFixedStartTime: changed.response.request.fixedStartTime, targetClassId: f.punchId, expectedTargetStartRule: "PUNCH", fixedStartTime: null };
    expect((await transferEntryAsAdministrator(db, { ...f.actor, entryId: f.entryId,
      idempotencyKey: `entry-transfer:${randomUUID()}`, request: back }, now)).status).toBe("transferred");
    const finalEntry = (await pool.query<{ class_id: string; fixed_start_time: Date | null; version: number }>(
      "SELECT class_id,fixed_start_time,version FROM entry WHERE id=$1", [f.entryId])).rows[0];
    expect(finalEntry).toEqual({ class_id: f.punchId, fixed_start_time: null, version: 3 });
    const beforeRetry = await state(f.raceId);
    const replay = await transferEntryAsAdministrator(db, { ...f.actor, entryId: f.entryId, idempotencyKey: key,
      request: { ...f.request, fixedStartTime: "2026-09-12T10:03:04.125Z" } }, now);
    expect(replay).toEqual({ status: "transferred", response: { ...changed.response, replayed: true } });
    expect(await state(f.raceId)).toBe(beforeRetry); expect(await preserved(f.raceId)).toBe(original);
    expect((await pool.query<{ actor_kind: string }>("SELECT actor_kind FROM audit_event WHERE race_id=$1 AND action='ENTRY_CLASS_AND_START_TRANSFERRED_BY_ADMIN'", [f.raceId])).rows)
      .toEqual([{ actor_kind: "RACE_ADMIN_ACCESS_CREDENTIAL" }, { actor_kind: "RACE_ADMIN_ACCESS_CREDENTIAL" }]);
    await expect(pool.query("UPDATE entry_transfer_request SET changed_at=changed_at WHERE race_id=$1", [f.raceId])).rejects.toThrow();
    await expect(pool.query("DELETE FROM entry_transfer_request WHERE race_id=$1", [f.raceId])).rejects.toThrow();
  });

  it("reads a class course name and version without requiring controls or the geometry projection", async () => {
    const f = await fixture(), emptyVersionId = randomUUID(), emptyClassId = randomUUID();
    await pool.query("INSERT INTO course_version(id,course_id,version) SELECT $1,course_id,101 FROM course_version WHERE id=$2",
      [emptyVersionId, f.courseVersionId]);
    await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'Utan kontroller',$3,'PUNCH')",
      [emptyClassId, f.raceId, emptyVersionId]);
    const list = await listEntryTransfersAsAdministrator(db, f.actor, now);
    if (list.status !== "ok") throw new Error("No candidate list");
    expect(list.response.classes.find(row => row.id === emptyClassId)).toMatchObject({
      courseVersionId: emptyVersionId, courseName: "Synthetic course", courseVersion: 101, entryCount: 0,
    });
  });

  it("rejects stale, unsupported, cross-scope, limited-role and altered-retry requests without writes", async () => {
    const f = await fixture(), secondActor = await auth(f.raceId), limited = await auth(f.raceId, "CHANGE_ENTRY_CLASS");
    const foreign = await fixture();
    const call = (request: unknown, overrides = {}) => transferEntryAsAdministrator(db, { ...f.actor, entryId: f.entryId,
      idempotencyKey: `entry-transfer:${randomUUID()}`, request, ...overrides }, now);
    const initial = await state(f.raceId);
    for (const patch of [{ expectedEntryVersion: 2 }, { expectedSnapshotVersion: 2 }, { expectedClassId: randomUUID() },
      { expectedFixedStartTime: "2026-09-12T10:00:00Z" }, { expectedTargetCourseVersionId: randomUUID() },
      { targetClassId: foreign.fixedId, expectedTargetCourseVersionId: foreign.courseVersionId },
      { expectedTargetStartRule: "PUNCH", fixedStartTime: null }]) {
      expect((await call({ ...f.request, ...patch })).status).toBe("conflict");
    }
    expect((await call({ ...f.request, targetClassId: f.punchId })).status).toBe("invalid-request");
    expect((await call({ ...f.request, fixedStartTime: null })).status).toBe("invalid-request");
    expect((await call(f.request, { csrfHeader: null })).status).toBe("forbidden");
    expect((await call(f.request, limited)).status).toBe("forbidden");
    expect((await call(f.request, { raceId: foreign.raceId })).status).toBe("forbidden");
    expect((await listEntryTransfersAsAdministrator(db, limited, now)).status).toBe("forbidden");
    expect(await state(f.raceId)).toBe(initial);
    const key = `entry-transfer:${randomUUID()}`;
    expect((await call(f.request, { idempotencyKey: key })).status).toBe("transferred");
    const after = await state(f.raceId);
    expect((await call(f.request, { ...secondActor, idempotencyKey: key })).status).toBe("conflict");
    expect((await call(f.request, { entryId: f.otherEntryId, idempotencyKey: key })).status).toBe("conflict");
    expect((await call({ ...f.request, fixedStartTime: "2026-09-12T10:05:00Z" }, { idempotencyKey: key })).status).toBe("conflict");
    expect(await state(f.raceId)).toBe(after);
  });

  it("serializes competing transfers and rejects both PostgreSQL version-overflow boundaries", async () => {
    const f = await fixture(), secondActor = await auth(f.raceId);
    const outcomes = await Promise.all([f.actor, secondActor].map(actor => transferEntryAsAdministrator(db, {
      ...actor, entryId: f.entryId, idempotencyKey: `entry-transfer:${randomUUID()}`, request: f.request }, now)));
    expect(outcomes.map(row => row.status).sort()).toEqual(["conflict", "transferred"]);
    expect((await pool.query("SELECT id FROM entry_transfer_request WHERE race_id=$1", [f.raceId])).rows).toHaveLength(1);
    const max = await fixture();
    await pool.query("UPDATE entry SET version=2147483647 WHERE id=$1", [max.entryId]);
    const beforeEntry = await state(max.raceId);
    expect((await transferEntryAsAdministrator(db, { ...max.actor, entryId: max.entryId, idempotencyKey: `entry-transfer:${randomUUID()}`,
      request: { ...max.request, expectedEntryVersion: 2147483647 } }, now)).status).toBe("conflict");
    expect(await state(max.raceId)).toBe(beforeEntry);
    await pool.query("UPDATE race SET snapshot_version=2147483647 WHERE id=$1", [max.raceId]);
    const beforeRace = await state(max.raceId);
    expect((await transferEntryAsAdministrator(db, { ...max.actor, entryId: max.entryId, idempotencyKey: `entry-transfer:${randomUUID()}`,
      request: { ...max.request, expectedEntryVersion: 2147483647, expectedSnapshotVersion: 2147483647 } }, now)).status).toBe("conflict");
    expect(await state(max.raceId)).toBe(beforeRace);
  });

  it("does not silently omit a class with a foreign course or round an unrepresentable stored start time", async () => {
    const f = await fixture(), other = await fixture();
    await pool.query("UPDATE class SET course_version_id=$1 WHERE id=$2", [other.courseVersionId, f.fixedId]);
    await expect(listEntryTransfersAsAdministrator(db, f.actor, now)).rejects.toThrow("klass");
    expect((await transferEntryAsAdministrator(db, { ...f.actor, entryId: f.entryId, idempotencyKey: `entry-transfer:${randomUUID()}`,
      request: { ...f.request, expectedTargetCourseVersionId: other.courseVersionId } }, now)).status).toBe("conflict");
    await pool.query("UPDATE class SET course_version_id=$1 WHERE id=$2", [f.courseVersionId, f.fixedId]);
    await pool.query("UPDATE entry SET fixed_start_time='2026-09-12T10:00:00.000001Z' WHERE id=$1", [f.entryId]);
    await expect(listEntryTransfersAsAdministrator(db, f.actor, now)).rejects.toThrow("precision");
    const before = await state(f.raceId);
    expect((await transferEntryAsAdministrator(db, { ...f.actor, entryId: f.entryId, idempotencyKey: `entry-transfer:${randomUUID()}`,
      request: { ...f.request, expectedFixedStartTime: "2026-09-12T10:00:00.000Z" } }, now)).status).toBe("conflict");
    expect(await state(f.raceId)).toBe(before);
  });
});
