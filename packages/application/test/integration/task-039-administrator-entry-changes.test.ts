import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import { listAdministratorEntryChanges } from "../../src/administrator-entry-changes";
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

async function identity(f: Awaited<ReturnType<typeof fixture>>, version: number) {
  const before = { givenName: "Before", familyName: "Synthetic", organisationName: null };
  const after = { ...before, givenName: "After" };
  await pool.query(`INSERT INTO entry_identity_change_request(request_id,race_id,entry_id,class_id,actor_credential_id,capability,
    previous_identity,identity,entry_version_before,entry_version_after,snapshot_version_before,snapshot_version_after,changed_at)
    VALUES($1,$2,$3,$4,$5,'MANAGE_RACE',$6,$7,$8,$9,$8,$9,$10)`,
    [randomUUID(), f.raceId, f.entryId, f.classId, f.administrator.actorId, JSON.stringify(before), JSON.stringify(after), version - 1, version, now]);
}
async function read(f: Awaited<ReturnType<typeof fixture>>, beforeVersion?: number) {
  return listAdministratorEntryChanges(db, { ...f.administrator, entryId: f.entryId, ...(beforeVersion === undefined ? {} : { beforeVersion }) }, now);
}
describe("TASK039 administrator entry changes", () => {
  it("merges six immutable journal sources with frozen values, historical class labels and no writes", async () => {
    const f = await fixture(), target = randomUUID(), secondCard = randomUUID();
    await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'Other class',$3,'FIXED')", [target, f.raceId, f.courseVersionId]);
    const oldCard = (await pool.query<{ id: string }>("SELECT id FROM card_assignment WHERE race_id=$1", [f.raceId])).rows[0]!.id;
    await pool.query("INSERT INTO card_assignment(id,race_id,entry_id,card_number) VALUES($1,$2,$3,'54321')", [secondCard, f.raceId, f.entryId]);
    const registration = { formatVersion: 1, classId: f.classId, expectedCourseVersionId: f.courseVersionId, expectedStartRule: "PUNCH",
      expectedSnapshotVersion: 1, givenName: "Original", familyName: "Synthetic", organisationName: null, cardNumber: "12345", fixedStartTime: null };
    await pool.query("INSERT INTO entry_registration_request(request_id,race_id,actor_credential_id,entry_id,assignment_id,request,snapshot_version_after,created_at) VALUES($1,$2,$3,$4,$5,$6,2,$7)",
      [randomUUID(), f.raceId, f.administrator.actorId, f.entryId, oldCard, JSON.stringify(registration), now]);
    await pool.query(`INSERT INTO entry_class_change_request(request_id,race_id,actor_credential_id,entry_id,expected_entry_version,
      previous_class_id,class_id,entry_version_before,entry_version_after,snapshot_version_before,snapshot_version_after,changed_at)
      VALUES($1,$2,$3,$4,1,$5,$6,1,2,2,3,$7)`, [randomUUID(), f.raceId, f.administrator.actorId, f.entryId, target, f.classId, now]);
    const transfer = { formatVersion: 1, expectedEntryVersion: 2, expectedClassId: f.classId, expectedSnapshotVersion: 3,
      expectedFixedStartTime: null, targetClassId: target, expectedTargetCourseVersionId: f.courseVersionId,
      expectedTargetStartRule: "FIXED", fixedStartTime: "2026-09-12T10:00:00.125Z" };
    await pool.query(`INSERT INTO entry_transfer_request(request_id,race_id,entry_id,actor_credential_id,capability,previous_class_id,target_class_id,
      request,entry_version_before,entry_version_after,snapshot_version_before,snapshot_version_after,changed_at)
      VALUES($1,$2,$3,$4,'MANAGE_RACE',$5,$6,$7,2,3,3,4,$8)`,
      [randomUUID(), f.raceId, f.entryId, f.administrator.actorId, f.classId, target, JSON.stringify(transfer), now]);
    await pool.query(`INSERT INTO entry_card_change_request(request_id,race_id,entry_id,class_id,actor_credential_id,
      previous_assignment_id,previous_card_number,active_assignment_id,card_number,entry_version_before,entry_version_after,
      snapshot_version_before,snapshot_version_after,changed_at) VALUES($1,$2,$3,$4,$5,$6,'12345',$7,'54321',3,4,4,5,$8)`,
      [randomUUID(), f.raceId, f.entryId, target, f.administrator.actorId, oldCard, secondCard, now]);
    await pool.query(`INSERT INTO entry_start_time_change_request(request_id,race_id,actor_credential_id,entry_id,expected_entry_version,
      previous_fixed_start_time,fixed_start_time,class_id,entry_version_before,entry_version_after,snapshot_version_before,snapshot_version_after,changed_at)
      VALUES($1,$2,$3,$4,4,'2026-09-12T10:00:00.125Z','2026-09-12T10:02:00Z',$5,4,5,5,6,$6)`,
      [randomUUID(), f.raceId, f.administrator.actorId, f.entryId, target, now]);
    await identity(f, 6);
    await pool.query("UPDATE entry SET version=6 WHERE id=$1", [f.entryId]);
    await pool.query("UPDATE race SET snapshot_version=7 WHERE id=$1", [f.raceId]);
    const footprint = async () => JSON.stringify((await pool.query("SELECT * FROM audit_event WHERE race_id=$1 ORDER BY id", [f.raceId])).rows);
    const before = await footprint();
    const result = await read(f);
    if (result.status !== "ok") throw new Error("History failed");
    expect(result.response.items.map(row => row.kind)).toEqual(["IDENTITY", "START_TIME", "CARD", "TRANSFER", "CLASS", "REGISTRATION"]);
    expect(result.response.items[0]?.changes).toContainEqual({ field: "GIVEN_NAME", before: "Before", after: "After" });
    expect(result.response.items[3]?.changes).toContainEqual({ field: "START_TIME", before: null, after: "2026-09-12T10:00:00.125Z" });
    expect(result.response.items[4]?.changes).toEqual([{ field: "CLASS", before: "Other class", after: "Synthetic class" }]);
    expect(result.response.nextBeforeVersion).toBeNull();
    expect(await footprint()).toBe(before);
  });
  it("pages by exclusive version and denies limited authority and foreign entries", async () => {
    const f = await fixture(), other = await fixture(), reader = await auth(f.raceId, "VIEW_START_LIST");
    for (let version = 2; version <= 23; version++) await identity(f, version);
    await pool.query("UPDATE entry SET version=23 WHERE id=$1", [f.entryId]);
    await pool.query("UPDATE race SET snapshot_version=23 WHERE id=$1", [f.raceId]);
    const first = await read(f);
    if (first.status !== "ok") throw new Error("History failed");
    expect(first.response.items).toHaveLength(20); expect(first.response.nextBeforeVersion).toBe(4);
    const next = await read(f, 4);
    expect(next).toMatchObject({ status: "ok", response: { items: [{ entryVersionAfter: 3 }, { entryVersionAfter: 2 }], nextBeforeVersion: null } });
    expect((await listAdministratorEntryChanges(db, { ...reader, entryId: f.entryId }, now)).status).toBe("forbidden");
    expect((await listAdministratorEntryChanges(db, { ...f.administrator, entryId: other.entryId }, now)).status).toBe("not-found");
    expect((await read(f, 0)).status).toBe("invalid-request");
  });
  it("rejects duplicate versions, future journals and submillisecond stored times", async () => {
    const f = await fixture(); await identity(f, 2);
    await expect(read(f)).rejects.toThrow("journal");
    await pool.query("UPDATE entry SET version=2 WHERE id=$1", [f.entryId]);
    await pool.query("UPDATE race SET snapshot_version=2 WHERE id=$1", [f.raceId]);
    await pool.query(`INSERT INTO entry_start_time_change_request(request_id,race_id,actor_credential_id,entry_id,expected_entry_version,
      previous_fixed_start_time,fixed_start_time,class_id,entry_version_before,entry_version_after,snapshot_version_before,snapshot_version_after,changed_at)
      VALUES($1,$2,$3,$4,1,null,'2026-09-12T10:02:00.000001Z',$5,1,2,1,2,$6)`,
      [randomUUID(), f.raceId, f.administrator.actorId, f.entryId, f.classId, now]);
    await expect(read(f)).rejects.toThrow("journal");
    const g = await fixture(); await identity(g, 2);
    await pool.query("UPDATE entry SET version=2 WHERE id=$1", [g.entryId]);
    await pool.query("UPDATE race SET snapshot_version=2 WHERE id=$1", [g.raceId]);
    await pool.query(`INSERT INTO entry_start_time_change_request(request_id,race_id,actor_credential_id,entry_id,expected_entry_version,
      previous_fixed_start_time,fixed_start_time,class_id,entry_version_before,entry_version_after,snapshot_version_before,snapshot_version_after,changed_at)
      VALUES($1,$2,$3,$4,1,null,'2026-09-12T10:02:00Z',$5,1,2,1,2,$6)`,
      [randomUUID(), g.raceId, g.administrator.actorId, g.entryId, g.classId, now]);
    await expect(read(g)).rejects.toThrow("journal");
  });
  it("rejects a historical class from another race instead of labeling it as local", async () => {
    const f = await fixture(), other = await fixture();
    await pool.query("UPDATE entry SET version=2 WHERE id=$1", [f.entryId]);
    await pool.query("UPDATE race SET snapshot_version=2 WHERE id=$1", [f.raceId]);
    await pool.query(`INSERT INTO entry_class_change_request(request_id,race_id,actor_credential_id,entry_id,expected_entry_version,
      previous_class_id,class_id,entry_version_before,entry_version_after,snapshot_version_before,snapshot_version_after,changed_at)
      VALUES($1,$2,$3,$4,1,$5,$6,1,2,1,2,$7)`,
      [randomUUID(), f.raceId, f.administrator.actorId, f.entryId, other.classId, f.classId, now]);
    await expect(read(f)).rejects.toThrow("relation");
  });
});
