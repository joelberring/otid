import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import { listEntryTransfersAsAdministrator } from "../../src/entry-transfer";
import { changeEntryCardAsAdmin } from "../../src/entry-card";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/hash";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-12T13:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
async function auth(raceId: string, capability: "MANAGE_RACE" | "CHANGE_ENTRY_CARD" | "VIEW_START_LIST" = "MANAGE_RACE") {
  const installation = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Synthetic admin card",
    expiresAt: new Date(now.getTime() + 3600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential },
    { expectedRaceId: raceId, expectedCapability: capability, now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
}
async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const classId = randomUUID(), entryId = randomUUID(), otherEntryId = randomUUID(), assignmentId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'Synthetic card','2026-09-12','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'Synthetic card','2026-09-12')", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Synthetic course')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  const controlId = randomUUID();
  await pool.query("INSERT INTO control(id,race_id,code) VALUES($1,$2,31)", [controlId, raceId]);
  await pool.query("INSERT INTO course_control(course_version_id,control_id,sequence) VALUES($1,$2,1)", [courseVersionId, controlId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'Synthetic class',$3,'PUNCH')", [classId, raceId, courseVersionId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$3,$4,'Ada','Synthetic'),($2,$3,$4,'Bo','Synthetic')", [entryId, otherEntryId, raceId, classId]);
  await pool.query("INSERT INTO card_assignment(id,race_id,entry_id,card_number) VALUES($1,$2,$3,'12345')", [assignmentId, raceId, entryId]);
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number,active) VALUES($1,$2,'67890',false)", [raceId, otherEntryId]);
  return { raceId, entryId, otherEntryId, classId, assignmentId, administrator: await auth(raceId) };
}
async function cardInput(actor: Awaited<ReturnType<typeof auth>>, entryId: string, cardNumber: string) {
  const listed = await listEntryTransfersAsAdministrator(db, actor, now);
  if (listed.status !== "ok") throw new Error("List unavailable");
  const entry = listed.response.entries.find(row => row.id === entryId);
  if (!entry) throw new Error("Entry missing");
  return { ...actor, entryId, idempotencyKey: `entry-card-change:${randomUUID()}`, request: {
    formatVersion: 1, expectedEntryVersion: entry.version, expectedClassId: entry.classId,
    expectedSnapshotVersion: listed.response.snapshotVersion, expectedAssignment: entry.activeAssignment, cardNumber
  } };
}
async function footprint(raceId: string) {
  const raw = (await pool.query("SELECT * FROM raw_device_message WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const results = (await pool.query("SELECT * FROM result_revision WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const readouts = (await pool.query("SELECT * FROM card_readout WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ raw, results, readouts });
}
async function mutableState(raceId: string) {
  const entries = (await pool.query("SELECT * FROM entry WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const cards = (await pool.query("SELECT * FROM card_assignment WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const journal = (await pool.query("SELECT * FROM entry_card_change_request WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const race = (await pool.query("SELECT * FROM race WHERE id=$1", [raceId])).rows;
  const audit = (await pool.query("SELECT * FROM audit_event WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ entries, cards, journal, race, audit });
}

describe("TASK030 administrator card change", () => {
  it("keeps actual admin actor, immutable readouts/results, historical ownership and exact retry", async () => {
    const f = await fixture(), other = await auth(f.raceId), limited = await auth(f.raceId, "CHANGE_ENTRY_CARD");
    const reader = await auth(f.raceId, "VIEW_START_LIST");
    const payload = { cardNumber: "12345", startPunchedAt: "2026-09-12T10:00:00Z", finishPunchedAt: "2026-09-12T10:20:00Z",
      punches: [{ code: 31, punchedAt: "2026-09-12T10:10:00Z" }] };
    const deviceId = randomUUID();
    const ingest = await ingestDeviceBatch(db, f.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
      firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T10:21:00Z",
        transport: "simulator", payload, contentHash: contentHash(payload) }] });
    expect(ingest.acknowledgements[0]?.status).toBe("stored");
    const before = await footprint(f.raceId);
    const input = await cardInput(f.administrator, f.entryId, "54321");
    const changed = await changeEntryCardAsAdmin(db, input, now);
    if (changed.status !== "changed") throw new Error("Card change failed");
    expect(changed.response).toMatchObject({ previousAssignment: { id: f.assignmentId, cardNumber: "12345" },
      activeAssignment: { cardNumber: "54321" }, entryVersionAfter: 2, snapshotVersionAfter: 2 });
    const back = await cardInput(f.administrator, f.entryId, "12345");
    // A limited operator still acts under its original audit identity, not as an administrator.
    const restored = await changeEntryCardAsAdmin(db, { ...back, ...limited }, now);
    expect(restored.status === "changed" && restored.response.activeAssignment).toEqual({ id: f.assignmentId, cardNumber: "12345" });
    const stable = await mutableState(f.raceId);
    expect(await changeEntryCardAsAdmin(db, input, now)).toEqual({ status: "changed", response: { ...changed.response, replayed: true } });
    expect((await changeEntryCardAsAdmin(db, { ...input, ...other }, now)).status).toBe("conflict");
    expect((await changeEntryCardAsAdmin(db, { ...input, request: { ...input.request, cardNumber: "54322" } }, now)).status).toBe("conflict");
    expect((await changeEntryCardAsAdmin(db, { ...input, ...reader }, now)).status).toBe("forbidden");
    expect((await changeEntryCardAsAdmin(db, { ...input, csrfHeader: null }, now)).status).toBe("forbidden");
    const owned = await cardInput(f.administrator, f.entryId, "67890");
    expect((await changeEntryCardAsAdmin(db, owned, now)).status).toBe("conflict");
    expect(await mutableState(f.raceId)).toBe(stable); expect(await footprint(f.raceId)).toBe(before);
    expect((await pool.query<{ actor_kind: string }>("SELECT actor_kind FROM audit_event WHERE race_id=$1 AND action='ENTRY_CARD_CHANGED_BY_ADMIN' ORDER BY actor_kind::text", [f.raceId])).rows)
      .toEqual([{ actor_kind: "ENTRY_CARD_ACCESS_CREDENTIAL" }, { actor_kind: "RACE_ADMIN_ACCESS_CREDENTIAL" }]);
  });

  it("projects null/single/multiple active assignments in the same private scope without choosing a conflict", async () => {
    const f = await fixture(), foreign = await fixture();
    const listed = await listEntryTransfersAsAdministrator(db, f.administrator, now);
    if (listed.status !== "ok") throw new Error("List unavailable");
    expect(listed.response.entries.find(row => row.id === f.entryId)).toMatchObject({ activeAssignment: { id: f.assignmentId, cardNumber: "12345" }, multipleActiveAssignments: false });
    expect(listed.response.entries.find(row => row.id === f.otherEntryId)).toMatchObject({ activeAssignment: null, multipleActiveAssignments: false });
    expect(listed.response.entries.some(row => row.id === foreign.entryId)).toBe(false);
    await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,'54321')", [f.raceId, f.entryId]);
    const conflict = await listEntryTransfersAsAdministrator(db, f.administrator, now);
    expect(conflict.status === "ok" && conflict.response.entries.find(row => row.id === f.entryId))
      .toMatchObject({ activeAssignment: null, multipleActiveAssignments: true });
    const before = await mutableState(f.raceId);
    expect((await changeEntryCardAsAdmin(db, await cardInput(f.administrator, f.entryId, "99999"), now)).status).toBe("conflict");
    expect(await mutableState(f.raceId)).toBe(before);
    expect((await listEntryTransfersAsAdministrator(db, { ...f.administrator, raceId: foreign.raceId }, now)).status).toBe("forbidden");
    expect((await listEntryTransfersAsAdministrator(db, await auth(f.raceId, "CHANGE_ENTRY_CARD"), now)).status).toBe("forbidden");
  });
});
