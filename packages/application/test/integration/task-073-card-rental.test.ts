import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import { listEntryTransfersAsAdministrator } from "../../src/entry-transfer";
import { changeEntryCardRentalAsAdministrator } from "../../src/entry-card-rental";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-18T08:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function auth(raceId: string, capability: "MANAGE_RACE" | "CHANGE_ENTRY_CARD" = "MANAGE_RACE") {
  const installation = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Synthetic rental",
    expiresAt: new Date(now.getTime() + 3600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential },
    { expectedRaceId: raceId, expectedCapability: capability, now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
}

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const classId = randomUUID(), entryId = randomUUID(), assignmentId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'Synthetic rental','2026-09-18','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'Synthetic rental','2026-09-18')", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Synthetic course')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'Synthetic class',$3,'PUNCH')", [classId, raceId, courseVersionId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$2,$3,'Ada','Synthetic')", [entryId, raceId, classId]);
  await pool.query("INSERT INTO card_assignment(id,race_id,entry_id,card_number) VALUES($1,$2,$3,'12345')", [assignmentId, raceId, entryId]);
  return { raceId, classId, entryId, assignmentId, administrator: await auth(raceId) };
}

async function input(f: Awaited<ReturnType<typeof fixture>>, isRental: boolean) {
  const listed = await listEntryTransfersAsAdministrator(db, f.administrator, now);
  if (listed.status !== "ok") throw new Error("Roster unavailable");
  const entry = listed.response.entries.find(row => row.id === f.entryId);
  if (!entry?.activeAssignment) throw new Error("Assignment unavailable");
  return { ...f.administrator, entryId: f.entryId, idempotencyKey: `entry-card-rental-change:${randomUUID()}`,
    request: { formatVersion: 1, expectedEntryVersion: entry.version, expectedClassId: entry.classId,
      expectedSnapshotVersion: listed.response.snapshotVersion, expectedAssignment: {
        id: entry.activeAssignment.id, cardNumber: entry.activeAssignment.cardNumber,
        isRental: entry.activeAssignment.isRental
      }, isRental } };
}

async function protectedFootprint(raceId: string) {
  const raw = (await pool.query("SELECT * FROM raw_device_message WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const readouts = (await pool.query("SELECT * FROM card_readout WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const results = (await pool.query("SELECT * FROM result_revision WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ raw, readouts, results });
}

describe("TASK073 journalförd hyrbricksstatus", () => {
  it("markerar och avmarkerar samma aktiva koppling med exakt retry utan att röra tävlingsdata", async () => {
    const f = await fixture(), before = await protectedFootprint(f.raceId);
    const mark = await input(f, true);
    const changed = await changeEntryCardRentalAsAdministrator(db, mark, now);
    if (changed.status !== "changed") throw new Error("Rental marking failed");
    expect(changed.response).toMatchObject({ replayed: false, assignment: { id: f.assignmentId, cardNumber: "12345" },
      previousIsRental: false, isRental: true, entryVersionAfter: 2, snapshotVersionAfter: 2 });
    expect(await changeEntryCardRentalAsAdministrator(db, mark, now)).toEqual({ status: "changed",
      response: { ...changed.response, replayed: true } });
    const unmark = await input(f, false);
    expect(await changeEntryCardRentalAsAdministrator(db, unmark, new Date(now.getTime() + 1000))).toMatchObject({
      status: "changed", response: { previousIsRental: true, isRental: false, entryVersionAfter: 3, snapshotVersionAfter: 3 }
    });
    expect((await pool.query("SELECT is_rental FROM card_assignment WHERE id=$1", [f.assignmentId])).rows).toEqual([{ is_rental: false }]);
    expect((await pool.query("SELECT previous_is_rental,is_rental FROM entry_card_rental_change WHERE race_id=$1 ORDER BY changed_at", [f.raceId])).rows)
      .toEqual([{ previous_is_rental: false, is_rental: true }, { previous_is_rental: true, is_rental: false }]);
    expect((await pool.query("SELECT action FROM audit_event WHERE race_id=$1 AND action='ENTRY_CARD_RENTAL_CHANGED_BY_ADMIN' ORDER BY created_at", [f.raceId])).rows)
      .toEqual([{ action: "ENTRY_CARD_RENTAL_CHANGED_BY_ADMIN" }, { action: "ENTRY_CARD_RENTAL_CHANGED_BY_ADMIN" }]);
    await expect(pool.query("UPDATE entry_card_rental_change SET is_rental=true WHERE race_id=$1", [f.raceId])).rejects.toThrow();
    expect(await protectedFootprint(f.raceId)).toBe(before);
  });

  it("avvisar annan aktör, ändrat intent, begränsad roll, stale och oklar aktiv koppling atomiskt", async () => {
    const f = await fixture(), other = await auth(f.raceId), limited = await auth(f.raceId, "CHANGE_ENTRY_CARD");
    const mark = await input(f, true);
    expect((await changeEntryCardRentalAsAdministrator(db, mark, now)).status).toBe("changed");
    expect((await changeEntryCardRentalAsAdministrator(db, { ...mark, ...other }, now)).status).toBe("conflict");
    expect((await changeEntryCardRentalAsAdministrator(db, { ...mark, request: { ...mark.request,
      expectedAssignment: { ...mark.request.expectedAssignment, isRental: true }, isRental: false } }, now)).status).toBe("conflict");
    expect((await changeEntryCardRentalAsAdministrator(db, { ...mark, ...limited }, now)).status).toBe("forbidden");
    const stale = await input(f, false);
    await pool.query("UPDATE entry SET version=version+1 WHERE id=$1", [f.entryId]);
    expect((await changeEntryCardRentalAsAdministrator(db, stale, now)).status).toBe("conflict");
    await pool.query("UPDATE entry SET version=version-1 WHERE id=$1", [f.entryId]);
    await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,'54321')", [f.raceId, f.entryId]);
    expect((await changeEntryCardRentalAsAdministrator(db, stale, now)).status).toBe("conflict");
    expect((await pool.query("SELECT count(*)::int AS count FROM entry_card_rental_change WHERE race_id=$1", [f.raceId])).rows)
      .toEqual([{ count: 1 }]);
  });
});
