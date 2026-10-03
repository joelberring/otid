import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import { ClassCapacityConflictError } from "../../src/class-capacity-guard";
import { changeClassCapacityAsAdministrator } from "../../src/class-capacity";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { listEntryTransfersAsAdministrator, transferEntryAsAdministrator } from "../../src/entry-transfer";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { changeEntryClass, changeEntryClassAsAdmin } from "../../src/results";
import { importIofXml, importIofXmlAsAdmin } from "../../src/import-iof";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för en uttryckligen isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-12T12:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function auth(raceId: string, capability: "MANAGE_RACE" | "REGISTER_ENTRY" | "CHANGE_ENTRY_CLASS" | "IMPORT_IOF") {
  const installation = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Synthetic capacity",
    expiresAt: new Date(now.getTime() + 3600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential },
    { expectedRaceId: raceId, expectedCapability: capability, now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
}
async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const sourceId = randomUUID(), targetId = randomUUID(), entryId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'Synthetic capacity','2026-09-12','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'Synthetic capacity','2026-09-12')", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Synthetic course')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule,external_source,external_id) VALUES($1,$3,'Source',$4,'PUNCH','iof','source'),($2,$3,'Target',$4,'PUNCH','iof','target')",
    [sourceId, targetId, raceId, courseVersionId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name,external_source,external_id) VALUES($1,$2,$3,'Ada','Synthetic','iof','ada')",
    [entryId, raceId, sourceId]);
  const administrator = await auth(raceId, "MANAGE_RACE"), registration = await auth(raceId, "REGISTER_ENTRY");
  const legacy = await auth(raceId, "CHANGE_ENTRY_CLASS"), importer = await auth(raceId, "IMPORT_IOF");
  const request = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: sourceId, expectedSnapshotVersion: 1,
    expectedFixedStartTime: null, targetClassId: targetId, expectedTargetCourseVersionId: courseVersionId,
    expectedTargetStartRule: "PUNCH", fixedStartTime: null };
  const registrationRequest = { formatVersion: 1, classId: targetId, expectedCourseVersionId: courseVersionId,
    expectedStartRule: "PUNCH", expectedSnapshotVersion: 1, givenName: "Bo", familyName: "Synthetic",
    organisationName: null, cardNumber: null, fixedStartTime: null };
  return { raceId, sourceId, targetId, entryId, courseVersionId, administrator, registration, legacy, importer, request, registrationRequest };
}
async function footprint(raceId: string) {
  const entries = (await pool.query("SELECT * FROM entry WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const race = (await pool.query("SELECT * FROM race WHERE id=$1", [raceId])).rows;
  const classes = (await pool.query("SELECT * FROM class WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const cards = (await pool.query("SELECT * FROM card_assignment WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const imports = (await pool.query("SELECT * FROM import_file WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const requests = (await pool.query("SELECT * FROM iof_import_request WHERE race_id=$1 ORDER BY request_id", [raceId])).rows;
  const transfers = (await pool.query("SELECT * FROM entry_transfer_request WHERE race_id=$1 ORDER BY request_id", [raceId])).rows;
  const registrations = (await pool.query("SELECT * FROM entry_registration_request WHERE race_id=$1 ORDER BY request_id", [raceId])).rows;
  const legacy = (await pool.query("SELECT * FROM entry_class_change_request WHERE race_id=$1 ORDER BY request_id", [raceId])).rows;
  const capacities = (await pool.query("SELECT * FROM class_capacity_change_request WHERE race_id=$1 ORDER BY request_id", [raceId])).rows;
  const audit = (await pool.query("SELECT * FROM audit_event WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ entries, race, classes, cards, imports, requests, transfers, registrations, legacy, capacities, audit });
}
function xml(rows: Array<{ id: string; name: string; raceClass: "source" | "target"; card?: string }>) {
  return `<EntryList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"><Event><Name>Synthetic capacity</Name></Event>${rows.map(row =>
    `<PersonEntry><Id>${row.id}</Id><Person><Name><Family>Synthetic</Family><Given>${row.name}</Given></Name></Person>${row.card ? `<ControlCard>${row.card}</ControlCard>` : ""}<Class><Id>${row.raceClass}</Id><Name>${row.raceClass}</Name></Class></PersonEntry>`).join("")}</EntryList>`;
}

describe("TASK029 shared class capacity guard, real PostgreSQL", () => {
  it("sets a versioned capacity with immutable exact retry but never changes the race snapshot", async () => {
    const f = await fixture(), other = await auth(f.raceId, "MANAGE_RACE");
    const key = `class-capacity:${randomUUID()}`;
    const request = { formatVersion: 1, expectedCapacityVersion: 1, expectedMaxEntries: null, maxEntries: 1 };
    const input = { ...f.administrator, classId: f.sourceId, idempotencyKey: key, request };
    const before = await footprint(f.raceId);
    expect((await changeClassCapacityAsAdministrator(db, { ...input, request: { ...request, maxEntries: 0 } }, now)).status).toBe("conflict");
    expect((await changeClassCapacityAsAdministrator(db, { ...input, request: { ...request, maxEntries: null } }, now)).status).toBe("invalid-request");
    expect((await changeClassCapacityAsAdministrator(db, { ...input, request: { ...request, expectedCapacityVersion: 2 } }, now)).status).toBe("conflict");
    expect((await changeClassCapacityAsAdministrator(db, { ...input, csrfHeader: null }, now)).status).toBe("forbidden");
    expect((await changeClassCapacityAsAdministrator(db, { ...input, ...f.legacy }, now)).status).toBe("forbidden");
    expect(await footprint(f.raceId)).toBe(before);
    const changed = await changeClassCapacityAsAdministrator(db, input, now);
    if (changed.status !== "changed") throw new Error("Capacity change failed");
    expect(changed.response).toMatchObject({ previousMaxEntries: null, maxEntries: 1, entryCount: 1, versionBefore: 1, versionAfter: 2 });
    expect((await changeClassCapacityAsAdministrator(db, { ...input, idempotencyKey: `class-capacity:${randomUUID()}`,
      request: { formatVersion: 1, expectedCapacityVersion: 2, expectedMaxEntries: 1, maxEntries: 2 } }, now)).status).toBe("changed");
    const after = await footprint(f.raceId);
    expect(await changeClassCapacityAsAdministrator(db, input, now)).toEqual({ status: "changed", response: { ...changed.response, replayed: true } });
    expect((await changeClassCapacityAsAdministrator(db, { ...input, ...other }, now)).status).toBe("conflict");
    expect((await changeClassCapacityAsAdministrator(db, { ...input, request: { ...request, maxEntries: 2 } }, now)).status).toBe("conflict");
    expect((await changeClassCapacityAsAdministrator(db, { ...input, classId: f.targetId }, now)).status).toBe("conflict");
    expect(await footprint(f.raceId)).toBe(after);
    expect((await pool.query<{ snapshot_version: number }>("SELECT snapshot_version FROM race WHERE id=$1", [f.raceId])).rows[0]?.snapshot_version).toBe(1);
    expect((await pool.query<{ version: number }>("SELECT version FROM entry WHERE id=$1", [f.entryId])).rows[0]?.version).toBe(1);
    await expect(pool.query("UPDATE class_capacity_change_request SET max_entries=max_entries WHERE race_id=$1", [f.raceId])).rejects.toThrow();
    await expect(pool.query("DELETE FROM class_capacity_change_request WHERE race_id=$1", [f.raceId])).rejects.toThrow();
  });
  it("blocks cap zero/full in every single-entry writer and preserves exact successful retries", async () => {
    const f = await fixture();
    const transferKey = `entry-transfer:${randomUUID()}`;
    const transfer = () => transferEntryAsAdministrator(db, { ...f.administrator, entryId: f.entryId, idempotencyKey: transferKey, request: f.request }, now);
    const registration = () => registerEntryAsAdmin(db, { ...f.registration, idempotencyKey: `entry-registration:${randomUUID()}`, request: f.registrationRequest }, now);
    const legacyKey = `entry-class-change:${randomUUID()}`;
    const legacy = () => changeEntryClassAsAdmin(db, { ...f.legacy, entryId: f.entryId, idempotencyKey: legacyKey,
      request: { formatVersion: 1, expectedEntryVersion: 1, classId: f.targetId } }, now);
    await pool.query("UPDATE class SET max_entries=0 WHERE id=$1", [f.targetId]);
    const before = await footprint(f.raceId);
    expect((await transfer()).status).toBe("conflict"); expect((await registration()).status).toBe("conflict");
    expect((await legacy()).status).toBe("conflict");
    await expect(changeEntryClass(db, f.raceId, f.entryId, f.targetId)).rejects.toBeInstanceOf(ClassCapacityConflictError);
    expect(await footprint(f.raceId)).toBe(before);
    await pool.query("UPDATE class SET max_entries=1 WHERE id=$1", [f.targetId]);
    expect((await transfer()).status).toBe("transferred");
    const full = await footprint(f.raceId);
    const replay = await transfer(); expect(replay.status === "transferred" && replay.response.replayed).toBe(true);
    expect(await footprint(f.raceId)).toBe(full);
    expect((await registerEntryAsAdmin(db, { ...f.registration, idempotencyKey: `entry-registration:${randomUUID()}`,
      request: { ...f.registrationRequest, expectedSnapshotVersion: 2 } }, now)).status).toBe("conflict");
    const list = await listEntryTransfersAsAdministrator(db, f.administrator, now);
    expect(list.status === "ok" && list.response.classes.find(row => row.id === f.targetId))
      .toMatchObject({ maxEntries: 1, entryCount: 1, capacityVersion: 1 });
    // Legacy exact-retry is checked before today's full-class guard as well.
    const other = await fixture();
    await pool.query("UPDATE class SET max_entries=1 WHERE id=$1", [other.targetId]);
    const old = { ...other.legacy, entryId: other.entryId, idempotencyKey: `entry-class-change:${randomUUID()}`,
      request: { formatVersion: 1, expectedEntryVersion: 1, classId: other.targetId } };
    expect((await changeEntryClassAsAdmin(db, old, now)).status).toBe("changed");
    const oldReplay = await changeEntryClassAsAdmin(db, old, now);
    expect(oldReplay.status === "changed" && oldReplay.response.replayed).toBe(true);
  });

  it("serializes registration versus transfer for the last place and keeps null unlimited", async () => {
    const f = await fixture();
    await pool.query("UPDATE class SET max_entries=1 WHERE id=$1", [f.targetId]);
    const outcomes = await Promise.all([
      transferEntryAsAdministrator(db, { ...f.administrator, entryId: f.entryId, idempotencyKey: `entry-transfer:${randomUUID()}`, request: f.request }, now),
      registerEntryAsAdmin(db, { ...f.registration, idempotencyKey: `entry-registration:${randomUUID()}`, request: f.registrationRequest }, now)
    ]);
    expect(outcomes.filter(row => row.status === "conflict")).toHaveLength(1);
    expect((await pool.query<{ count: string }>("SELECT count(*) FROM entry WHERE class_id=$1", [f.targetId])).rows[0]?.count).toBe("1");
    expect((await registerEntryAsAdmin(db, { ...f.registration, idempotencyKey: `entry-registration:${randomUUID()}`,
      request: { ...f.registrationRequest, expectedSnapshotVersion: 2 } }, now)).status).toBe("conflict");
    await pool.query("UPDATE class SET max_entries=null WHERE id=$1", [f.targetId]);
    const key = `entry-registration:${randomUUID()}`;
    const input = { ...f.registration, idempotencyKey: key, request: { ...f.registrationRequest, expectedSnapshotVersion: 2 } };
    expect((await registerEntryAsAdmin(db, input, now)).status).toBe("registered");
    await pool.query("UPDATE class SET max_entries=2 WHERE id=$1", [f.targetId]);
    const beforeRetry = await footprint(f.raceId);
    const replay = await registerEntryAsAdmin(db, input, now);
    expect(replay.status === "registered" && replay.response.replayed).toBe(true);
    expect(await footprint(f.raceId)).toBe(beforeRetry);
  });

  it("rolls back the entire overfull import but permits an atomic full-class swap and old content retry", async () => {
    const f = await fixture();
    await pool.query("UPDATE class SET max_entries=0,capacity_version=2 WHERE id=$1", [f.targetId]);
    const rejected = xml([{ id: "ada", name: "Changed", raceClass: "source" }, { id: "bo", name: "Bo", raceClass: "target", card: "67890" }]);
    const before = await footprint(f.raceId);
    await expect(importIofXml(db, f.raceId, rejected)).rejects.toBeInstanceOf(ClassCapacityConflictError);
    expect((await importIofXmlAsAdmin(db, { ...f.importer, idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: Buffer.from(rejected) }, now)).status).toBe("conflict");
    expect(await footprint(f.raceId)).toBe(before);
    await pool.query("UPDATE class SET max_entries=1 WHERE race_id=$1", [f.raceId]);
    const initial = xml([{ id: "ada", name: "Ada", raceClass: "source" }, { id: "bo", name: "Bo", raceClass: "target" }]);
    const key = `iof-import:${randomUUID()}`;
    const input = { ...f.importer, idempotencyKey: key, xmlBytes: Buffer.from(initial) };
    expect((await importIofXmlAsAdmin(db, input, now)).status).toBe("stored");
    const swapped = xml([{ id: "ada", name: "Ada", raceClass: "target" }, { id: "bo", name: "Bo", raceClass: "source" }]);
    await importIofXml(db, f.raceId, swapped);
    expect((await pool.query<{ external_id: string; class_id: string }>("SELECT external_id,class_id FROM entry WHERE race_id=$1 ORDER BY external_id", [f.raceId])).rows)
      .toEqual([{ external_id: "ada", class_id: f.targetId }, { external_id: "bo", class_id: f.sourceId }]);
    const beforeRetry = await footprint(f.raceId);
    const replay = await importIofXmlAsAdmin(db, input, now);
    expect(replay.status === "stored" && replay.response.replayed).toBe(true);
    await importIofXml(db, f.raceId, initial);
    expect(await footprint(f.raceId)).toBe(beforeRetry);
    expect((await pool.query<{ max_entries: number; capacity_version: number }>("SELECT max_entries,capacity_version FROM class WHERE id=$1", [f.targetId])).rows[0])
      .toEqual({ max_entries: 1, capacity_version: 2 });
  });
});
