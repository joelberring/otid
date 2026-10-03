import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import { listEntryRegistrationStartSlotsAsAdmin, registerEntryAsAdmin } from "../../src/entry-registration";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för en uttryckligen isolerad testdatabas");
const { db, pool } = createDatabase(url), now = new Date("2026-09-12T10:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
async function auth(raceId: string, capability: "REGISTER_ENTRY" | "MANAGE_RACE" = "REGISTER_ENTRY") {
  const issued = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "TASK110 synthetic", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential }, { expectedRaceId: raceId, expectedCapability: capability, now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken, actorId: issued.credentialId };
}
async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID(), classId = randomUUID(), sourceClassId = randomUUID();
  const occupiedId = randomUUID(), departedId = randomUUID(), drawId = randomUUID(), sourceHash = "b".repeat(64);
  const occupiedAt = "2026-09-12T12:02:00.000Z", vacantAt = "2026-09-12T12:03:00.000Z";
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK110 synthetic','2026-09-12','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date,snapshot_version) VALUES($1,$2,'Lång','2026-09-12',2)", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Bana')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'D21',$3,'FIXED'),($4,$2,'Öppen',$3,'PUNCH')", [classId, raceId, courseVersionId, sourceClassId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name,fixed_start_time) VALUES($1,$2,$3,'Cid','Kvar',$4),($5,$2,$6,'Dan','Flyttad',NULL)", [occupiedId, raceId, classId, occupiedAt, departedId, sourceClassId]);
  const actor = await auth(raceId);
  await pool.query("INSERT INTO class_start_draw_request(id,request_id,race_id,class_id,actor_credential_id,source_hash,time_zone,algorithm_version,seed,first_start_time,interval_seconds,entry_count,changed_entry_count,snapshot_version_before,snapshot_version_after,changed_at) VALUES($1,$2,$3,$4,$5,$6,'Europe/Stockholm','task110',1,$7,60,2,2,1,2,$8)", [drawId, randomUUID(), raceId, classId, actor.actorId, sourceHash, occupiedAt, now]);
  await pool.query("INSERT INTO class_start_draw_item(draw_request_id,entry_id,display_name,previous_fixed_start_time,fixed_start_time,entry_version_before,entry_version_after) VALUES($1,$2,'Cid Kvar',$3,$3,1,1),($1,$4,'Dan Flyttad',NULL,$5,1,2)", [drawId, occupiedId, occupiedAt, departedId, vacantAt]);
  const request = { formatVersion: 1 as const, classId, expectedCourseVersionId: courseVersionId, expectedStartRule: "FIXED" as const, expectedSnapshotVersion: 2, expectedTargetCapacityVersion: 1, givenName: "Ada", familyName: "Ny", organisationName: null, cardNumber: null, fixedStartTime: vacantAt, assignedStartSlot: { drawRequestId: drawId, sourceHash, fixedStartTime: vacantAt } };
  return { raceId, classId, drawId, sourceHash, vacantAt, actor, request };
}

describe("TASK110 assigned fixed start slot registration, real PostgreSQL", () => {
  it("lists, writes and replays one exact lottad slot", async () => {
    const f = await fixture();
    expect(await listEntryRegistrationStartSlotsAsAdmin(db, { ...f.actor, targetClassId: f.classId }, now)).toMatchObject({ status: "ok", response: { plan: { status: "AVAILABLE", drawRequestId: f.drawId, sourceHash: f.sourceHash, slots: [{ fixedStartTime: f.vacantAt }] } } });
    const key = `entry-registration:${randomUUID()}`, saved = await registerEntryAsAdmin(db, { ...f.actor, idempotencyKey: key, request: f.request }, now);
    if (saved.status !== "registered") throw new Error("TASK110 registration failed");
    expect(saved.response.assignedStartSlot).toMatchObject({ drawRequestId: f.drawId, sourceHash: f.sourceHash, fixedStartTime: f.vacantAt });
    expect((await pool.query("SELECT id FROM entry_registration_start_slot_assignment WHERE race_id=$1", [f.raceId])).rows).toHaveLength(1);
    expect(await registerEntryAsAdmin(db, { ...f.actor, idempotencyKey: key, request: f.request }, now)).toEqual({ status: "registered", response: { ...saved.response, replayed: true } });
    await expect(pool.query("UPDATE entry_registration_start_slot_assignment SET assigned_at=assigned_at WHERE race_id=$1", [f.raceId])).rejects.toThrow();
  });
  it("allows only one writer to claim a slot and rejects a fabricated time atomically", async () => {
    const f = await fixture(), second = await auth(f.raceId), key = () => `entry-registration:${randomUUID()}`;
    const outcomes = await Promise.all([registerEntryAsAdmin(db, { ...f.actor, idempotencyKey: key(), request: f.request }, now), registerEntryAsAdmin(db, { ...second, idempotencyKey: key(), request: { ...f.request, givenName: "Bo" } }, now)]);
    expect(outcomes.map(value => value.status).sort()).toEqual(["conflict", "registered"]);
    const fresh = await fixture(), fabricated = "2026-09-12T12:04:00.000Z";
    expect((await registerEntryAsAdmin(db, { ...fresh.actor, idempotencyKey: key(), request: { ...fresh.request, fixedStartTime: fabricated, assignedStartSlot: { ...fresh.request.assignedStartSlot, fixedStartTime: fabricated } } }, now)).status).toBe("conflict");
    expect((await pool.query("SELECT id FROM entry_registration_start_slot_assignment WHERE race_id=$1", [fresh.raceId])).rows).toHaveLength(0);
  });
});
