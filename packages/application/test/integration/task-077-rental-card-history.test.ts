import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import { listAdministratorEntryChanges } from "../../src/administrator-entry-changes";
import { listEntryTransfersAsAdministrator } from "../../src/entry-transfer";
import { changeEntryCardRentalAsAdministrator } from "../../src/entry-card-rental";
import { changeEntryCardRentalReturnAsAdministrator } from "../../src/entry-card-rental-return";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-19T10:00:00Z");

beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function auth(raceId: string) {
  const installation = await issuePairingAdminAccessCredential(db, {
    raceId, capability: "MANAGE_RACE", label: "Synthetic rental history", expiresAt: new Date(now.getTime() + 3600_000)
  }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential }, {
    expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now
  });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
}

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const classId = randomUUID(), entryId = randomUUID(), assignmentId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'Synthetic rental history','2026-09-19','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'Synthetic rental history','2026-09-19')", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Synthetic course')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'Synthetic class',$3,'PUNCH')", [classId, raceId, courseVersionId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$2,$3,'Ada','Synthetic')", [entryId, raceId, classId]);
  await pool.query("INSERT INTO card_assignment(id,race_id,entry_id,card_number) VALUES($1,$2,$3,'12345')", [assignmentId, raceId, entryId]);
  return { raceId, classId, entryId, assignmentId, administrator: await auth(raceId) };
}

async function active(f: Awaited<ReturnType<typeof fixture>>) {
  const listed = await listEntryTransfersAsAdministrator(db, f.administrator, now);
  if (listed.status !== "ok") throw new Error("Roster unavailable");
  const entry = listed.response.entries.find(row => row.id === f.entryId);
  if (!entry?.activeAssignment) throw new Error("Assignment unavailable");
  return { entry, snapshotVersion: listed.response.snapshotVersion };
}

async function changeRental(f: Awaited<ReturnType<typeof fixture>>, isRental: boolean, changedAt: Date) {
  const current = await active(f);
  return changeEntryCardRentalAsAdministrator(db, {
    ...f.administrator, entryId: f.entryId, idempotencyKey: `entry-card-rental-change:${randomUUID()}`,
    request: { formatVersion: 1, expectedEntryVersion: current.entry.version, expectedClassId: current.entry.classId,
      expectedSnapshotVersion: current.snapshotVersion, expectedAssignment: {
        id: current.entry.activeAssignment!.id, cardNumber: current.entry.activeAssignment!.cardNumber,
        isRental: current.entry.activeAssignment!.isRental
      }, isRental }
  }, changedAt);
}

async function changeReturn(f: Awaited<ReturnType<typeof fixture>>, rentalReturned: boolean, changedAt: Date) {
  const current = await active(f);
  return changeEntryCardRentalReturnAsAdministrator(db, {
    ...f.administrator, entryId: f.entryId, idempotencyKey: `entry-card-rental-return-change:${randomUUID()}`,
    request: { formatVersion: 1, expectedEntryVersion: current.entry.version, expectedClassId: current.entry.classId,
      expectedSnapshotVersion: current.snapshotVersion, expectedAssignment: current.entry.activeAssignment, rentalReturned }
  }, changedAt);
}

describe("TASK077 hyrbricksbeslut i deltagarhistoriken", () => {
  it("läser hyrmarkering, återlämning och rättning i verklig journalordning med exklusiv cursor utan skrivning", async () => {
    const f = await fixture();
    const markedAt = new Date("2026-09-19T10:00:01Z");
    const returnedAt = new Date("2026-09-19T10:00:02Z");
    const correctedAt = new Date("2026-09-19T10:00:03Z");
    const unmarkedAt = new Date("2026-09-19T10:00:04Z");
    expect(await changeRental(f, true, markedAt)).toMatchObject({ status: "changed", response: { entryVersionAfter: 2, snapshotVersionAfter: 2 } });
    expect(await changeReturn(f, true, returnedAt)).toMatchObject({ status: "changed", response: { entryVersionAfter: 3, snapshotVersionAfter: 3 } });
    expect(await changeReturn(f, false, correctedAt)).toMatchObject({ status: "changed", response: { entryVersionAfter: 4, snapshotVersionAfter: 4 } });
    expect(await changeRental(f, false, unmarkedAt)).toMatchObject({ status: "changed", response: { entryVersionAfter: 5, snapshotVersionAfter: 5 } });
    const footprint = async () => JSON.stringify((await pool.query(`SELECT entry_version_after,snapshot_version_after,changed_at
      FROM entry_card_rental_change WHERE race_id=$1 UNION ALL SELECT entry_version_after,snapshot_version_after,changed_at
      FROM entry_card_rental_return_change WHERE race_id=$1 ORDER BY entry_version_after`, [f.raceId])).rows);
    const before = await footprint();
    const result = await listAdministratorEntryChanges(db, { ...f.administrator, entryId: f.entryId }, now);
    if (result.status !== "ok") throw new Error("History failed");
    expect(result.response).toMatchObject({ entryVersion: 5, snapshotVersion: 5, nextBeforeVersion: null });
    expect(result.response.items.map(({ kind, entryVersionAfter, snapshotVersionAfter, changedAt, changes }) =>
      ({ kind, entryVersionAfter, snapshotVersionAfter, changedAt, changes }))).toEqual([
      { kind: "RENTAL", entryVersionAfter: 5, snapshotVersionAfter: 5, changedAt: "2026-09-19T10:00:04.000000Z", changes: [{ field: "RENTAL", before: "true", after: "false" }] },
      { kind: "RENTAL_RETURN", entryVersionAfter: 4, snapshotVersionAfter: 4, changedAt: "2026-09-19T10:00:03.000000Z", changes: [{ field: "RENTAL_RETURN", before: "true", after: "false" }] },
      { kind: "RENTAL_RETURN", entryVersionAfter: 3, snapshotVersionAfter: 3, changedAt: "2026-09-19T10:00:02.000000Z", changes: [{ field: "RENTAL_RETURN", before: "false", after: "true" }] },
      { kind: "RENTAL", entryVersionAfter: 2, snapshotVersionAfter: 2, changedAt: "2026-09-19T10:00:01.000000Z", changes: [{ field: "RENTAL", before: "false", after: "true" }] }
    ]);
    const page = await listAdministratorEntryChanges(db, { ...f.administrator, entryId: f.entryId, beforeVersion: 5 }, now);
    expect(page).toMatchObject({ status: "ok", response: { items: [
      { entryVersionAfter: 4 }, { entryVersionAfter: 3 }, { entryVersionAfter: 2 }
    ], nextBeforeVersion: null } });
    expect(await footprint()).toBe(before);
  });

  it("avvisar dubbla deltagarversioner över hyrjournalerna", async () => {
    const f = await fixture();
    expect(await changeRental(f, true, new Date("2026-09-19T10:01:00Z"))).toMatchObject({
      status: "changed", response: { entryVersionAfter: 2, snapshotVersionAfter: 2 }
    });
    await pool.query(`INSERT INTO entry_card_rental_return_change(
      request_id,race_id,entry_id,class_id,assignment_id,card_number,actor_credential_id,capability,
      previous_rental_returned,rental_returned,entry_version_before,entry_version_after,
      snapshot_version_before,snapshot_version_after,changed_at)
      SELECT $1,race_id,entry_id,class_id,assignment_id,card_number,actor_credential_id,capability,
        false,true,entry_version_before,entry_version_after,snapshot_version_before,snapshot_version_after,$2
      FROM entry_card_rental_change WHERE race_id=$3`, [randomUUID(), new Date("2026-09-19T10:01:01Z"), f.raceId]);
    await expect(listAdministratorEntryChanges(db, { ...f.administrator, entryId: f.entryId }, now))
      .rejects.toThrow("Deltagarhistorikens journal eller relation är ogiltig");
  });
});
