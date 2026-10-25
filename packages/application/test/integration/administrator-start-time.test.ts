import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import { listEntryStartTimesAsAdmin, changeEntryStartTimeAsAdmin } from "../../src/entry-start-time";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/serialization";
import { raceLogin } from "./accounts";
import { statusFlow } from "./entry-status-helpers";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-12T14:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
async function auth(raceId: string, role: "ADMIN" | "FUNCTIONARY" = "ADMIN") {
  const login = await raceLogin(db, raceId, role, now);
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken, actorId: login.accountId };
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
    formatVersion: 1, expectedEntryVersion: 1, expectedClassId: classId, expectedFixedStartTime: "2026-09-12T10:00:00Z", fixedStartTime: "2026-09-12T12:05:00.125+02:00"
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
async function results(raceId: string) {
  type Row = { revision: number; cause: string; evaluation: { elapsedMs: number } };
  return (await pool.query<Row>("SELECT * FROM result_revision WHERE race_id=$1 ORDER BY revision", [raceId])).rows;
}
async function preserved(raceId: string) {
  const classes = (await pool.query("SELECT * FROM class WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const raw = (await pool.query("SELECT * FROM raw_device_message WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const readouts = (await pool.query("SELECT * FROM card_readout WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const cards = (await pool.query("SELECT * FROM card_assignment WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ classes, raw, readouts, cards });
}

describe("TASK031 administrator start-time correction", () => {
  it("retains genuine admin/limited actors, exact historical retry, untouched class/raw and appends recalculated results", async () => {
    const f = await fixture(), limited = await auth(f.raceId, "ADMIN"), other = await auth(f.raceId);
    const payload = { cardNumber: "12345", startPunchedAt: "2026-09-12T10:00:00Z", finishPunchedAt: "2026-09-12T10:20:00Z",
      punches: [{ code: 31, punchedAt: "2026-09-12T10:10:00Z" }] };
    const deviceId = randomUUID();
    const ingested = await ingestDeviceBatch(db, f.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
      firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T10:21:00Z",
        transport: "simulator", payload, contentHash: contentHash(payload) }] });
    expect(ingested.acknowledgements[0]?.status).toBe("stored");
    const original = await preserved(f.raceId);
    const originalResults = await results(f.raceId);
    const changed = await changeEntryStartTimeAsAdmin(db, f.input, now);
    if (changed.status !== "changed") throw new Error("Start-time change failed");
    expect(changed.response).toMatchObject({ previousFixedStartTime: "2026-09-12T10:00:00.000Z",
      fixedStartTime: "2026-09-12T10:05:00.125Z", classId: f.classId, entryVersionAfter: 2, snapshotVersionAfter: 2 });
    expect((await changeEntryStartTimeAsAdmin(db, { ...f.input, ...limited, idempotencyKey: `entry-start-time-change:${randomUUID()}`,
      request: { ...f.input.request, expectedEntryVersion: 2, expectedFixedStartTime: changed.response.fixedStartTime, fixedStartTime: "2026-09-12T10:06:00Z" } }, now)).status).toBe("changed");
    const beforeReplay = await state(f.raceId);
    expect(await changeEntryStartTimeAsAdmin(db, { ...f.input, request: { ...f.input.request, fixedStartTime: "2026-09-12T10:05:00.125Z" } }, now))
      .toEqual({ status: "changed", response: { ...changed.response, replayed: true } });
    expect((await changeEntryStartTimeAsAdmin(db, { ...f.input, ...other }, now)).status).toBe("conflict");
    expect(await state(f.raceId)).toBe(beforeReplay); expect(await preserved(f.raceId)).toBe(original);
    // Fast starttid ingår i bedömningsunderlaget: varje ändring räknar om resultatet med en ny revision (ADR-0169 beslut 1).
    const recalculated = await results(f.raceId);
    expect(recalculated.slice(0, originalResults.length)).toEqual(originalResults);
    expect(recalculated.slice(originalResults.length).map((row) => [row.revision, row.cause, row.evaluation.elapsedMs]))
      .toEqual([[2, "EXPLICIT_RECALCULATION", 14 * 60_000 + 59_875], [3, "EXPLICIT_RECALCULATION", 14 * 60_000]]);
    expect((await pool.query<{ actor_kind: string }>("SELECT actor_kind FROM audit_event WHERE race_id=$1 AND action='ENTRY_START_TIME_CHANGED_BY_ADMIN' ORDER BY actor_kind::text", [f.raceId])).rows)
      .toEqual([{ actor_kind: "USER_ACCOUNT" }, { actor_kind: "USER_ACCOUNT" }]);
    await pool.query("UPDATE entry SET fixed_start_time='2026-09-12T10:06:00.000001Z' WHERE id=$1", [f.entryId]);
    const withMicro = await state(f.raceId);
    expect(await changeEntryStartTimeAsAdmin(db, f.input, now)).toEqual({ status: "changed", response: { ...changed.response, replayed: true } });
    expect(await state(f.raceId)).toBe(withMicro);
  });

  it("steg 44: en manuell tid följer med när starttiden flyttas och resultatet är aktuellt", async () => {
    const f = await fixture();
    const payload = { cardNumber: "12345", startPunchedAt: "2026-09-12T10:00:00Z", finishPunchedAt: "2026-09-12T10:20:00Z",
      punches: [{ code: 31, punchedAt: "2026-09-12T10:10:00Z" }] };
    const deviceId = randomUUID();
    await ingestDeviceBatch(db, f.raceId, { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1,
      events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T10:21:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] });
    const decided = await statusFlow(db).decide(f.administrator, f.entryId, { kind: "MANUAL_TIME", status: "OK",
      finishTime: "2026-09-12T10:25:00Z", note: "Målet stämplades inte" }, { now });
    expect(decided.status).toBe("decided");
    expect((await changeEntryStartTimeAsAdmin(db, f.input, now)).status).toBe("changed");
    const effective = await getAdministratorEffectiveResult(db, { ...f.administrator, entryId: f.entryId }, now);
    if (effective.status !== "ok" || effective.response.state !== "ACTIVE_RESULT") throw new Error("Resultat saknas");
    // Arrangörens måltid står kvar, starten följer den flyttade starttiden och resultatet bygger på det nya underlaget.
    expect(effective.response).toMatchObject({ resultCurrent: true, result: { status: "OK", elapsedMs: 19 * 60_000 + 59_875 } });
    expect((await results(f.raceId)).map((row) => row.cause)).toEqual(["CARD_READOUT", "MANUAL_TIME", "EXPLICIT_RECALCULATION",
      "MANUAL_TIME_WITHDRAWAL", "MANUAL_TIME"]);
  });

  it("steg 44: en manuell tid utan avläsning (tappad bricka) följer den flyttade starttiden", async () => {
    const f = await fixture();
    expect((await statusFlow(db).decide(f.administrator, f.entryId, { kind: "MANUAL_TIME", status: "OK",
      finishTime: "2026-09-12T10:25:00Z", note: "Tappade brickan" }, { now })).status).toBe("decided");
    expect((await changeEntryStartTimeAsAdmin(db, f.input, now)).status).toBe("changed");
    const effective = await getAdministratorEffectiveResult(db, { ...f.administrator, entryId: f.entryId }, now);
    if (effective.status !== "ok" || effective.response.state !== "ACTIVE_RESULT") throw new Error("Resultat saknas");
    expect(effective.response).toMatchObject({ resultCurrent: true, result: { status: "OK", elapsedMs: 19 * 60_000 + 59_875 } });
    expect((await results(f.raceId)).map((row) => row.cause)).toEqual(["MANUAL_TIME", "MANUAL_RESULT_REMOVED", "MANUAL_TIME"]);
  });

  it("rejects PUNCH, unauthorized/stale requests and submillisecond current state without writes", async () => {
    const f = await fixture(), reader = await auth(f.raceId, "FUNCTIONARY");
    const before = await state(f.raceId);
    expect((await changeEntryStartTimeAsAdmin(db, { ...f.input, csrfHeader: null }, now)).status).toBe("forbidden");
    expect((await changeEntryStartTimeAsAdmin(db, { ...f.input, ...reader }, now)).status).toBe("forbidden");
    for (const patch of [{ expectedEntryVersion: 2 }, { expectedFixedStartTime: null }, { fixedStartTime: f.input.request.expectedFixedStartTime }]) {
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
      await pool.query(`INSERT INTO entry_start_time_change_request(request_id,race_id,actor_account_id,entry_id,
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
