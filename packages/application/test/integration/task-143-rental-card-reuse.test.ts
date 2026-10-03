import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import { changeEntryCardAsAdmin } from "../../src/entry-card";
import { listAdministratorEntryChanges } from "../../src/administrator-entry-changes";
import { reuseReturnedRentalCardAsAdministrator } from "../../src/entry-card-rental-reuse";
import { listEntryTransfersAsAdministrator } from "../../src/entry-transfer";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-22T10:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function auth(raceId: string) {
  const installation = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE",
    label: "Synthetic rental reuse", expiresAt: new Date(now.getTime() + 3600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential },
    { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
}

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const classId = randomUUID(), sourceEntryId = randomUUID(), targetEntryId = randomUUID(), unrelatedEntryId = randomUUID(), sourceAssignmentId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'Synthetic rental reuse','2026-09-22','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'Synthetic rental reuse','2026-09-22')", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Synthetic course')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'Synthetic class',$3,'PUNCH')", [classId, raceId, courseVersionId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$2,$3,'Ada','Source'),($4,$2,$3,'Bo','Target'),($5,$2,$3,'Kim','Unrelated')", [sourceEntryId, raceId, classId, targetEntryId, unrelatedEntryId]);
  await pool.query("INSERT INTO card_assignment(id,race_id,entry_id,card_number,is_rental,rental_returned) VALUES($1,$2,$3,'12345',true,true)", [sourceAssignmentId, raceId, sourceEntryId]);
  return { raceId, classId, sourceEntryId, targetEntryId, unrelatedEntryId, sourceAssignmentId, administrator: await auth(raceId) };
}

async function input(f: Awaited<ReturnType<typeof fixture>>, key = randomUUID()) {
  const listed = await listEntryTransfersAsAdministrator(db, f.administrator, now);
  if (listed.status !== "ok") throw new Error("Roster unavailable");
  const source = listed.response.entries.find(row => row.id === f.sourceEntryId);
  const target = listed.response.entries.find(row => row.id === f.targetEntryId);
  if (!source?.activeAssignment || !target || target.activeAssignment) throw new Error("Synthetic source or target unavailable");
  return { ...f.administrator, entryId: target.id, idempotencyKey: `entry-card-rental-reuse:${key}`,
    request: { formatVersion: 1, expectedSnapshotVersion: listed.response.snapshotVersion,
      source: { entryId: source.id, classId: source.classId, entryVersion: source.version, assignment: source.activeAssignment },
      expectedTargetClassId: target.classId, expectedTargetEntryVersion: target.version } };
}

async function protectedFootprint(raceId: string) {
  const raw = (await pool.query("SELECT * FROM raw_device_message WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const readouts = (await pool.query("SELECT * FROM card_readout WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const results = (await pool.query("SELECT * FROM result_revision WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ raw, readouts, results });
}

describe("TASK143 återanvändning av återlämnad hyrbricka", () => {
  it("skapar en ny målkoppling och bevarar den återlämnade källan som historik", async () => {
    const f = await fixture(), before = await protectedFootprint(f.raceId), value = await input(f);
    const changed = await reuseReturnedRentalCardAsAdministrator(db, value, now);
    if (changed.status !== "changed") throw new Error("Rental reuse failed");
    expect(changed.response).toMatchObject({ replayed: false,
      source: { entryId: f.sourceEntryId, assignment: { id: f.sourceAssignmentId, cardNumber: "12345" } },
      target: { entryId: f.targetEntryId, assignment: { cardNumber: "12345", isRental: true, rentalReturned: false } },
      sourceEntryVersionBefore: 1, sourceEntryVersionAfter: 2,
      targetEntryVersionBefore: 1, targetEntryVersionAfter: 2, snapshotVersionBefore: 1, snapshotVersionAfter: 2 });
    expect(changed.response.target.assignment.id).not.toBe(f.sourceAssignmentId);
    expect(await reuseReturnedRentalCardAsAdministrator(db, value, now)).toEqual({ status: "changed",
      response: { ...changed.response, replayed: true } });
    expect((await pool.query("SELECT entry_id,card_number,active,is_rental,rental_returned FROM card_assignment WHERE race_id=$1 ORDER BY created_at,id", [f.raceId])).rows)
      .toEqual([{ entry_id: f.sourceEntryId, card_number: "12345", active: false, is_rental: true, rental_returned: true },
        { entry_id: f.targetEntryId, card_number: "12345", active: true, is_rental: true, rental_returned: false }]);
    expect((await pool.query("SELECT source_entry_id,target_entry_id,card_number,source_entry_version_after,target_entry_version_after,snapshot_version_after FROM entry_card_rental_reuse_request WHERE race_id=$1", [f.raceId])).rows)
      .toEqual([{ source_entry_id: f.sourceEntryId, target_entry_id: f.targetEntryId, card_number: "12345",
        source_entry_version_after: 2, target_entry_version_after: 2, snapshot_version_after: 2 }]);
    expect((await pool.query("SELECT action FROM audit_event WHERE race_id=$1 AND action='ENTRY_CARD_RENTAL_REUSED_BY_ADMIN'", [f.raceId])).rows)
      .toEqual([{ action: "ENTRY_CARD_RENTAL_REUSED_BY_ADMIN" }]);
    const listed = await listEntryTransfersAsAdministrator(db, f.administrator, now);
    expect(listed.status === "ok" && listed.response.entries.find(row => row.id === f.sourceEntryId)?.activeAssignment).toBeNull();
    expect(listed.status === "ok" && listed.response.entries.find(row => row.id === f.targetEntryId)?.activeAssignment)
      .toMatchObject({ cardNumber: "12345", isRental: true, rentalReturned: false });
    await expect(pool.query("UPDATE entry_card_rental_reuse_request SET card_number='9' WHERE race_id=$1", [f.raceId])).rejects.toThrow();
    expect(await protectedFootprint(f.raceId)).toBe(before);
  });

  it("avvisar stale eller felaktig grund och låter inte vanligt brickbyte ta en annan deltagares historik", async () => {
    const f = await fixture(), first = await input(f), changed = await reuseReturnedRentalCardAsAdministrator(db, first, now);
    if (changed.status !== "changed") throw new Error("Rental reuse failed");
    expect((await reuseReturnedRentalCardAsAdministrator(db, { ...first, idempotencyKey: `entry-card-rental-reuse:${randomUUID()}` }, now)).status).toBe("conflict");
    const other = await auth(f.raceId);
    expect((await reuseReturnedRentalCardAsAdministrator(db, { ...first, ...other }, now)).status).toBe("conflict");
    const listed = await listEntryTransfersAsAdministrator(db, f.administrator, now);
    if (listed.status !== "ok") throw new Error("Roster unavailable");
    const source = listed.response.entries.find(row => row.id === f.sourceEntryId);
    if (!source) throw new Error("Source missing");
    expect((await changeEntryCardAsAdmin(db, { ...f.administrator, entryId: source.id,
      idempotencyKey: `entry-card-change:${randomUUID()}`,
      request: { formatVersion: 1, expectedEntryVersion: source.version, expectedClassId: source.classId,
        expectedSnapshotVersion: listed.response.snapshotVersion, expectedAssignment: null, cardNumber: "12345" } }, now)).status).toBe("conflict");
    expect((await pool.query("SELECT count(*)::int AS count FROM entry_card_rental_reuse_request WHERE race_id=$1", [f.raceId])).rows)
      .toEqual([{ count: 1 }]);
  });

  it("TASK144 projicerar samma immutable återanvändning privat för källa och mål utan dubblett", async () => {
    const f = await fixture(), value = await input(f);
    const changed = await reuseReturnedRentalCardAsAdministrator(db, value, now);
    if (changed.status !== "changed") throw new Error("Rental reuse failed");
    expect(await reuseReturnedRentalCardAsAdministrator(db, value, now)).toEqual({ status: "changed",
      response: { ...changed.response, replayed: true } });
    const journalBefore = JSON.stringify((await pool.query(
      "SELECT * FROM entry_card_rental_reuse_request WHERE race_id=$1", [f.raceId])).rows);
    const source = await listAdministratorEntryChanges(db, { ...f.administrator, entryId: f.sourceEntryId }, now);
    const target = await listAdministratorEntryChanges(db, { ...f.administrator, entryId: f.targetEntryId }, now);
    const unrelated = await listAdministratorEntryChanges(db, { ...f.administrator, entryId: f.unrelatedEntryId }, now);
    if (source.status !== "ok" || target.status !== "ok" || unrelated.status !== "ok") throw new Error("History unavailable");
    expect(source.response.items).toEqual([expect.objectContaining({ kind: "RENTAL_REUSE", entryVersionAfter: 2,
      snapshotVersionAfter: 2, changes: [{ field: "RENTAL_REUSE", before: "RETURNED_RENTAL", after: "GIVEN_AWAY" },
        { field: "CARD", before: "12345", after: null }] })]);
    expect(target.response.items).toEqual([expect.objectContaining({ kind: "RENTAL_REUSE", entryVersionAfter: 2,
      snapshotVersionAfter: 2, changes: [{ field: "RENTAL_REUSE", before: "NO_ACTIVE_CARD", after: "RECEIVED_NOT_RETURNED" },
        { field: "CARD", before: null, after: "12345" }] })]);
    expect(source.response.items[0]!.requestId).toBe(target.response.items[0]!.requestId);
    expect(unrelated.response.items).toEqual([]);
    expect(JSON.stringify((await pool.query("SELECT * FROM entry_card_rental_reuse_request WHERE race_id=$1", [f.raceId])).rows))
      .toBe(journalBefore);
  });
});
