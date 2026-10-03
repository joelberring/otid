import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import { listEntryTransfersAsAdministrator } from "../../src/entry-transfer";
import { changeEntryPaymentStatusAsAdministrator } from "../../src/entry-payment-status";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-22T08:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function auth(raceId: string, capability: "MANAGE_RACE" | "CHANGE_ENTRY_CARD" = "MANAGE_RACE") {
  const installation = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Synthetic payment",
    expiresAt: new Date(now.getTime() + 3600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential },
    { expectedRaceId: raceId, expectedCapability: capability, now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
}

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const classId = randomUUID(), entryId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'Synthetic payment','2026-09-22','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'Synthetic payment','2026-09-22')", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Synthetic course')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'Synthetic class',$3,'PUNCH')", [classId, raceId, courseVersionId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$2,$3,'Ada','Payment')", [entryId, raceId, classId]);
  return { raceId, classId, entryId, administrator: await auth(raceId) };
}

async function input(f: Awaited<ReturnType<typeof fixture>>, paymentStatus: "UNMARKED" | "UNPAID" | "PAID" | "WAIVED") {
  const listed = await listEntryTransfersAsAdministrator(db, f.administrator, now);
  if (listed.status !== "ok") throw new Error("Roster unavailable");
  const entry = listed.response.entries.find(row => row.id === f.entryId);
  if (!entry) throw new Error("Entry unavailable");
  return { ...f.administrator, entryId: f.entryId, idempotencyKey: `entry-payment-status-change:${randomUUID()}`,
    request: { formatVersion: 1 as const, expectedEntryVersion: entry.version, expectedClassId: entry.classId,
      expectedPaymentStatus: entry.paymentStatus, expectedPaymentStatusVersion: entry.paymentStatusVersion, paymentStatus } };
}

async function protectedFootprint(raceId: string) {
  const raw = (await pool.query("SELECT * FROM raw_device_message WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const readouts = (await pool.query("SELECT * FROM card_readout WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const results = (await pool.query("SELECT * FROM result_revision WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ raw, readouts, results });
}

describe("TASK142 journalförd privat betalstatus", () => {
  it("sparar och återspelar status utan att ändra start, resultat eller tävlingssnapshot", async () => {
    const f = await fixture(), before = await protectedFootprint(f.raceId);
    const mark = await input(f, "PAID");
    const changed = await changeEntryPaymentStatusAsAdministrator(db, mark, now);
    if (changed.status !== "changed") throw new Error("Payment status change failed");
    expect(changed.response).toMatchObject({ replayed: false, previousPaymentStatus: "UNMARKED", paymentStatus: "PAID",
      entryVersionAtChange: 1, paymentStatusVersionBefore: 1, paymentStatusVersionAfter: 2 });
    expect(await changeEntryPaymentStatusAsAdministrator(db, mark, now)).toEqual({ status: "changed",
      response: { ...changed.response, replayed: true } });
    const waive = await input(f, "WAIVED");
    expect(await changeEntryPaymentStatusAsAdministrator(db, waive, new Date(now.getTime() + 1000))).toMatchObject({
      status: "changed", response: { previousPaymentStatus: "PAID", paymentStatus: "WAIVED", entryVersionAtChange: 1,
        paymentStatusVersionBefore: 2, paymentStatusVersionAfter: 3 }
    });
    expect((await pool.query("SELECT payment_status,payment_status_version,version FROM entry WHERE id=$1", [f.entryId])).rows)
      .toEqual([{ payment_status: "WAIVED", payment_status_version: 3, version: 1 }]);
    expect((await pool.query("SELECT snapshot_version FROM race WHERE id=$1", [f.raceId])).rows).toEqual([{ snapshot_version: 1 }]);
    expect((await pool.query("SELECT previous_payment_status,payment_status FROM entry_payment_status_change WHERE race_id=$1 ORDER BY changed_at", [f.raceId])).rows)
      .toEqual([{ previous_payment_status: "UNMARKED", payment_status: "PAID" }, { previous_payment_status: "PAID", payment_status: "WAIVED" }]);
    expect((await pool.query("SELECT action FROM audit_event WHERE race_id=$1 AND action='ENTRY_PAYMENT_STATUS_CHANGED_BY_ADMIN' ORDER BY created_at", [f.raceId])).rows)
      .toEqual([{ action: "ENTRY_PAYMENT_STATUS_CHANGED_BY_ADMIN" }, { action: "ENTRY_PAYMENT_STATUS_CHANGED_BY_ADMIN" }]);
    await expect(pool.query("UPDATE entry_payment_status_change SET payment_status='UNPAID' WHERE race_id=$1", [f.raceId])).rejects.toThrow();
    expect(await protectedFootprint(f.raceId)).toBe(before);
  });

  it("avvisar ändrad retry, fel aktör/roll och stale deltagar- eller betalstatusversion", async () => {
    const f = await fixture(), other = await auth(f.raceId), limited = await auth(f.raceId, "CHANGE_ENTRY_CARD");
    const mark = await input(f, "PAID");
    expect((await changeEntryPaymentStatusAsAdministrator(db, mark, now)).status).toBe("changed");
    expect((await changeEntryPaymentStatusAsAdministrator(db, { ...mark, ...other }, now)).status).toBe("conflict");
    expect((await changeEntryPaymentStatusAsAdministrator(db, { ...mark, request: { ...mark.request, paymentStatus: "UNPAID" } }, now)).status).toBe("conflict");
    expect((await changeEntryPaymentStatusAsAdministrator(db, { ...mark, ...limited }, now)).status).toBe("forbidden");
    const stalePayment = await input(f, "UNPAID");
    const currentPayment = await input(f, "WAIVED");
    expect((await changeEntryPaymentStatusAsAdministrator(db, currentPayment, now)).status).toBe("changed");
    expect((await changeEntryPaymentStatusAsAdministrator(db, stalePayment, now)).status).toBe("conflict");
    const staleEntry = await input(f, "PAID");
    await pool.query("UPDATE entry SET version=version+1 WHERE id=$1", [f.entryId]);
    expect((await changeEntryPaymentStatusAsAdministrator(db, staleEntry, now)).status).toBe("conflict");
    expect((await pool.query("SELECT count(*)::int AS count FROM entry_payment_status_change WHERE race_id=$1", [f.raceId])).rows)
      .toEqual([{ count: 2 }]);
  });
});
