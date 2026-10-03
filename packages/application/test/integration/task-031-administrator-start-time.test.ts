import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import { listEntryStartTimesAsAdmin, changeEntryStartTimeAsAdmin } from "../../src/entry-start-time";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/hash";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-12T14:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
async function auth(raceId: string, capability: "MANAGE_RACE" | "CHANGE_ENTRY_START_TIME" | "VIEW_START_LIST" = "MANAGE_RACE") {
  const installation = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Synthetic admin start",
    expiresAt: new Date(now.getTime() + 3600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential },
    { expectedRaceId: raceId, expectedCapability: capability, now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken, actorId: installation.credentialId };
}
async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const classId = randomUUID(), entryId = randomUUID(), controlId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'Synthetic start','2026-09-12','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'Synthetic start','2026-09-12')", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Synthetic course')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO control(id,race_id,code) VALUES($1,$2,31)", [controlId, raceId]);
  await pool.query("INSERT INTO course_control(course_version_id,control_id,sequence) VALUES($1,$2,1)", [courseVersionId, controlId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'Synthetic class',$3,'FIXED')", [classId, raceId, courseVersionId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name,fixed_start_time) VALUES($1,$2,$3,'Ada','Synthetic','2026-09-12T10:00:00Z')", [entryId, raceId, classId]);
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,'12345')", [raceId, entryId]);
  const administrator = await auth(raceId);
  const input = { ...administrator, entryId, idempotencyKey: `entry-start-time-change:${randomUUID()}`, request: {
    formatVersion: 1, expectedEntryVersion: 1, expectedClassId: classId, expectedSnapshotVersion: 1,
    expectedFixedStartTime: "2026-09-12T10:00:00Z", fixedStartTime: "2026-09-12T12:05:00.125+02:00"
  } };
  return { raceId, classId, entryId, administrator, input };
}
async function state(raceId: string) {
  const entries = (await pool.query("SELECT id,class_id,version,fixed_start_time::text AS time FROM entry WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const race = (await pool.query("SELECT * FROM race WHERE id=$1", [raceId])).rows;
  const journal = (await pool.query("SELECT *,previous_fixed_start_time::text AS previous_exact,fixed_start_time::text AS new_exact FROM entry_start_time_change_request WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const audit = (await pool.query("SELECT * FROM audit_event WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ entries, race, journal, audit });
}
async function preserved(raceId: string) {
  const classes = (await pool.query("SELECT * FROM class WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const raw = (await pool.query("SELECT * FROM raw_device_message WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const results = (await pool.query("SELECT * FROM result_revision WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const readouts = (await pool.query("SELECT * FROM card_readout WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const cards = (await pool.query("SELECT * FROM card_assignment WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ classes, raw, results, readouts, cards });
}

describe("TASK031 administrator start-time correction", () => {
  it("retains genuine admin/limited actors, exact historical retry and untouched class/raw/results", async () => {
    const f = await fixture(), limited = await auth(f.raceId, "CHANGE_ENTRY_START_TIME"), other = await auth(f.raceId);
    const payload = { cardNumber: "12345", startPunchedAt: "2026-09-12T10:00:00Z", finishPunchedAt: "2026-09-12T10:20:00Z",
      punches: [{ code: 31, punchedAt: "2026-09-12T10:10:00Z" }] };
    const deviceId = randomUUID();
    const ingested = await ingestDeviceBatch(db, f.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
      firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T10:21:00Z",
        transport: "simulator", payload, contentHash: contentHash(payload) }] });
    expect(ingested.acknowledgements[0]?.status).toBe("stored");
    const original = await preserved(f.raceId);
    const changed = await changeEntryStartTimeAsAdmin(db, f.input, now);
    if (changed.status !== "changed") throw new Error("Start-time change failed");
    expect(changed.response).toMatchObject({ previousFixedStartTime: "2026-09-12T10:00:00.000Z",
      fixedStartTime: "2026-09-12T10:05:00.125Z", classId: f.classId, entryVersionAfter: 2, snapshotVersionAfter: 2 });
    expect((await changeEntryStartTimeAsAdmin(db, { ...f.input, ...limited, idempotencyKey: `entry-start-time-change:${randomUUID()}`,
      request: { ...f.input.request, expectedEntryVersion: 2, expectedSnapshotVersion: 2,
        expectedFixedStartTime: changed.response.fixedStartTime, fixedStartTime: "2026-09-12T10:06:00Z" } }, now)).status).toBe("changed");
    const beforeReplay = await state(f.raceId);
    expect(await changeEntryStartTimeAsAdmin(db, { ...f.input, request: { ...f.input.request, fixedStartTime: "2026-09-12T10:05:00.125Z" } }, now))
      .toEqual({ status: "changed", response: { ...changed.response, replayed: true } });
    expect((await changeEntryStartTimeAsAdmin(db, { ...f.input, ...other }, now)).status).toBe("conflict");
    expect(await state(f.raceId)).toBe(beforeReplay); expect(await preserved(f.raceId)).toBe(original);
    expect((await pool.query<{ actor_kind: string }>("SELECT actor_kind FROM audit_event WHERE race_id=$1 AND action='ENTRY_START_TIME_CHANGED_BY_ADMIN' ORDER BY actor_kind::text", [f.raceId])).rows)
      .toEqual([{ actor_kind: "ENTRY_START_TIME_ACCESS_CREDENTIAL" }, { actor_kind: "RACE_ADMIN_ACCESS_CREDENTIAL" }]);
    await pool.query("UPDATE entry SET fixed_start_time='2026-09-12T10:06:00.000001Z' WHERE id=$1", [f.entryId]);
    const withMicro = await state(f.raceId);
    expect(await changeEntryStartTimeAsAdmin(db, f.input, now)).toEqual({ status: "changed", response: { ...changed.response, replayed: true } });
    expect(await state(f.raceId)).toBe(withMicro);
  });

  it("rejects PUNCH, unauthorized/stale requests and submillisecond current state without writes", async () => {
    const f = await fixture(), reader = await auth(f.raceId, "VIEW_START_LIST");
    const before = await state(f.raceId);
    expect((await changeEntryStartTimeAsAdmin(db, { ...f.input, csrfHeader: null }, now)).status).toBe("forbidden");
    expect((await changeEntryStartTimeAsAdmin(db, { ...f.input, ...reader }, now)).status).toBe("forbidden");
    for (const patch of [{ expectedEntryVersion: 2 }, { expectedSnapshotVersion: 2 }, { expectedFixedStartTime: null }, { fixedStartTime: f.input.request.expectedFixedStartTime }]) {
      expect((await changeEntryStartTimeAsAdmin(db, { ...f.input, request: { ...f.input.request, ...patch } }, now)).status).toBe("conflict");
    }
    expect(await state(f.raceId)).toBe(before);
    await pool.query("UPDATE class SET start_rule='PUNCH' WHERE id=$1", [f.classId]);
    expect((await changeEntryStartTimeAsAdmin(db, f.input, now)).status).toBe("conflict");
    expect(await listEntryStartTimesAsAdmin(db, f.administrator, now)).toMatchObject({ status: "ok", response: { entries: [] } });
    await pool.query("UPDATE class SET start_rule='FIXED' WHERE id=$1", [f.classId]);
    await pool.query("UPDATE entry SET fixed_start_time='2026-09-12T10:00:00.000001Z' WHERE id=$1", [f.entryId]);
    const micro = await state(f.raceId);
    await expect(listEntryStartTimesAsAdmin(db, f.administrator, now)).rejects.toThrow("precision");
    expect((await changeEntryStartTimeAsAdmin(db, f.input, now)).status).toBe("conflict");
    expect(await state(f.raceId)).toBe(micro);
  });

  it("rejects synthetic journal microseconds in either time without disabling immutability", async () => {
    for (const previousMicro of [true, false]) {
      const f = await fixture(), requestId = randomUUID();
      const previous = previousMicro ? "2026-09-12T10:00:00.000001Z" : "2026-09-12T10:00:00Z";
      const next = previousMicro ? "2026-09-12T10:05:00.125Z" : "2026-09-12T10:05:00.125001Z";
      await pool.query(`INSERT INTO entry_start_time_change_request(request_id,race_id,actor_credential_id,entry_id,
        expected_entry_version,previous_fixed_start_time,fixed_start_time,class_id,entry_version_before,entry_version_after,
        snapshot_version_before,snapshot_version_after,changed_at) VALUES($1,$2,$3,$4,1,$5,$6,$7,1,2,1,2,$8)`,
      [requestId, f.raceId, f.administrator.actorId, f.entryId, previous, next, f.classId, now]);
      const before = await state(f.raceId);
      expect((await changeEntryStartTimeAsAdmin(db, { ...f.input, idempotencyKey: `entry-start-time-change:${requestId}` }, now)).status).toBe("conflict");
      expect(await state(f.raceId)).toBe(before);
      await expect(pool.query("UPDATE entry_start_time_change_request SET changed_at=changed_at WHERE request_id=$1", [requestId])).rejects.toThrow();
    }
  });
});
