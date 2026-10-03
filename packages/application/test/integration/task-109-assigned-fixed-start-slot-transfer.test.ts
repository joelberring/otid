import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import type { EntryTransferRequest } from "@o-tid/contracts";
import { listEntryTransferStartSlotsAsAdministrator, transferEntryAsAdministrator } from "../../src/entry-transfer";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för en uttryckligen isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-12T10:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function auth(raceId: string) {
  const installation = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "TASK109 synthetic",
    expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential },
    { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
}

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const sourceClassId = randomUUID(), targetClassId = randomUUID(), entryId = randomUUID(), secondEntryId = randomUUID();
  const occupiedId = randomUUID(), departedId = randomUUID(), drawId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK109 synthetic','2026-09-12','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date,snapshot_version) VALUES($1,$2,'Lång','2026-09-12',2)", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Bana')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$3,'Fri',$4,'PUNCH'),($2,$3,'Öppen fast',$4,'FIXED')",
    [sourceClassId, targetClassId, raceId, courseVersionId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name,fixed_start_time) VALUES($1,$7,$5,'Ada','Flytt',NULL),($2,$7,$5,'Bo','Flytt',NULL),($3,$7,$6,'Cid','Kvar','2026-09-12T12:02:00.000Z'),($4,$7,$5,'Dan','Flyttad',NULL)",
    [entryId, secondEntryId, occupiedId, departedId, sourceClassId, targetClassId, raceId]);
  const actor = await auth(raceId);
  const credential = (await pool.query<{ id: string }>("SELECT id FROM pairing_admin_access_credential WHERE race_id=$1 ORDER BY issued_at LIMIT 1", [raceId])).rows[0];
  if (!credential) throw new Error("Missing synthetic credential");
  const sourceHash = "a".repeat(64), occupiedAt = "2026-09-12T12:02:00.000Z", vacantAt = "2026-09-12T12:03:00.000Z";
  await pool.query("INSERT INTO class_start_draw_request(id,request_id,race_id,class_id,actor_credential_id,source_hash,time_zone,algorithm_version,seed,first_start_time,interval_seconds,entry_count,changed_entry_count,snapshot_version_before,snapshot_version_after,changed_at) VALUES($1,$2,$3,$4,$5,$6,'Europe/Stockholm','task109',1,$7,60,2,2,1,2,$8)",
    [drawId, randomUUID(), raceId, targetClassId, credential.id, sourceHash, occupiedAt, now]);
  await pool.query("INSERT INTO class_start_draw_item(draw_request_id,entry_id,display_name,previous_fixed_start_time,fixed_start_time,entry_version_before,entry_version_after) VALUES($1,$2,'Cid Kvar',$3,$3,1,1),($1,$4,'Dan Flyttad',NULL,$5,1,2)",
    [drawId, occupiedId, occupiedAt, departedId, vacantAt]);
  const request: EntryTransferRequest = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: sourceClassId,
    expectedSnapshotVersion: 2, expectedFixedStartTime: null, targetClassId, expectedTargetCourseVersionId: courseVersionId,
    expectedTargetStartRule: "FIXED", expectedTargetCapacityVersion: 1, fixedStartTime: vacantAt,
    assignedStartSlot: { drawRequestId: drawId, sourceHash, fixedStartTime: vacantAt } };
  return { raceId, sourceClassId, targetClassId, entryId, secondEntryId, occupiedId, drawId, sourceHash, vacantAt, actor, request };
}

describe("TASK109 assigned fixed start slot transfer, real PostgreSQL", () => {
  it("lists only the current future vacancy, journals the transfer atomically and replays its exact proof", async () => {
    const f = await fixture();
    const candidates = await listEntryTransferStartSlotsAsAdministrator(db, { ...f.actor, entryId: f.entryId, targetClassId: f.targetClassId }, now);
    expect(candidates).toMatchObject({ status: "ok", response: { snapshotVersion: 2, plan: { status: "AVAILABLE", drawRequestId: f.drawId,
      sourceHash: f.sourceHash, slots: [{ fixedStartTime: f.vacantAt }] } } });
    const key = `entry-transfer:${randomUUID()}`;
    const changed = await transferEntryAsAdministrator(db, { ...f.actor, entryId: f.entryId, idempotencyKey: key, request: f.request }, now);
    if (changed.status !== "transferred") throw new Error("TASK109 transfer failed");
    expect(changed.response.assignedStartSlot).toMatchObject({ drawRequestId: f.drawId, sourceHash: f.sourceHash, fixedStartTime: f.vacantAt });
    expect((await pool.query("SELECT id FROM entry_start_slot_assignment WHERE race_id=$1", [f.raceId])).rows).toHaveLength(1);
    const replay = await transferEntryAsAdministrator(db, { ...f.actor, entryId: f.entryId, idempotencyKey: key, request: f.request }, now);
    expect(replay).toEqual({ status: "transferred", response: { ...changed.response, replayed: true } });
    await expect(pool.query("UPDATE entry_start_slot_assignment SET assigned_at=assigned_at WHERE race_id=$1", [f.raceId])).rejects.toThrow();
    await expect(pool.query("DELETE FROM entry_start_slot_assignment WHERE race_id=$1", [f.raceId])).rejects.toThrow();
  });

  it("admits only one concurrent claim and rejects a manual or passed slot without a half-journal", async () => {
    const f = await fixture(), other = await auth(f.raceId);
    const secondRequest = { ...f.request, expectedEntryVersion: 1, expectedClassId: f.sourceClassId };
    const outcomes = await Promise.all([
      transferEntryAsAdministrator(db, { ...f.actor, entryId: f.entryId, idempotencyKey: `entry-transfer:${randomUUID()}`, request: f.request }, now),
      transferEntryAsAdministrator(db, { ...other, entryId: f.secondEntryId, idempotencyKey: `entry-transfer:${randomUUID()}`, request: secondRequest }, now)
    ]);
    expect(outcomes.map(result => result.status).sort()).toEqual(["conflict", "transferred"]);
    expect((await pool.query("SELECT id FROM entry_start_slot_assignment WHERE race_id=$1", [f.raceId])).rows).toHaveLength(1);
    const fresh = await fixture();
    const invalid = await transferEntryAsAdministrator(db, { ...fresh.actor, entryId: fresh.entryId, idempotencyKey: `entry-transfer:${randomUUID()}`,
      request: { ...fresh.request, fixedStartTime: "2026-09-12T12:04:00.000Z", assignedStartSlot: { ...fresh.request.assignedStartSlot!, fixedStartTime: "2026-09-12T12:04:00.000Z" } } }, now);
    expect(invalid.status).toBe("conflict");
    expect((await pool.query("SELECT id FROM entry_start_slot_assignment WHERE race_id=$1", [fresh.raceId])).rows).toHaveLength(0);
  });
});
