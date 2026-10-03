import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import { listEntryRegistrationClassesAsAdmin, registerEntryAsAdmin } from "../../src/entry-registration";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/hash";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-12T14:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
async function auth(raceId: string, capability: "MANAGE_RACE" | "REGISTER_ENTRY" | "VIEW_START_LIST" = "MANAGE_RACE") {
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

async function inputFor(actor: Awaited<ReturnType<typeof auth>>, classId: string) {
  const list = await listEntryRegistrationClassesAsAdmin(db, actor, now);
  if (list.status !== "ok") throw new Error("Registration list failed");
  const target = list.response.classes.find(row => row.id === classId);
  if (!target) throw new Error("Missing class");
  return { ...actor, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
    formatVersion: 1, expectedSnapshotVersion: list.response.snapshotVersion, classId,
    expectedCourseVersionId: target.courseVersionId, expectedStartRule: target.startRule,
    givenName: "Alva", familyName: "Synthetic new", organisationName: "Synthetic OK", cardNumber: "54321",
    fixedStartTime: target.startRule === "FIXED" ? "2026-09-12T12:05:00+02:00" : null } };
}
async function preserved(raceId: string) {
  const raw = (await pool.query("SELECT * FROM raw_device_message WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const results = (await pool.query("SELECT * FROM result_revision WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const readouts = (await pool.query("SELECT * FROM card_readout WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ raw, results, readouts });
}
async function mutableState(raceId: string) {
  const entry = (await pool.query("SELECT * FROM entry WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const cards = (await pool.query("SELECT * FROM card_assignment WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const journal = (await pool.query("SELECT * FROM entry_registration_request WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const audit = (await pool.query("SELECT * FROM audit_event WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const race = (await pool.query("SELECT * FROM race WHERE id=$1", [raceId])).rows;
  return JSON.stringify({ entry, cards, journal, audit, race });
}
describe("TASK035 administrator registration", () => {
  it("registers with real admin and limited actors and replays historical identity without new results", async () => {
    const f = await fixture(), limited = await auth(f.raceId, "REGISTER_ENTRY");
    const input = await inputFor(f.administrator, f.classId), before = await preserved(f.raceId);
    const first = await registerEntryAsAdmin(db, input, now);
    if (first.status !== "registered") throw new Error("Registration failed");
    expect(first.response).toMatchObject({ entryVersion: 1, snapshotVersionBefore: 1,
      snapshotVersionAfter: 2, fixedStartTime: null, cardNumber: "54321" });
    expect(first.response.assignmentId).not.toBeNull();
    const next = await inputFor(limited, f.classId);
    expect((await registerEntryAsAdmin(db, { ...next, request: { ...next.request, cardNumber: null } }, now)).status).toBe("registered");
    await pool.query("UPDATE entry SET given_name='Later synthetic',version=2 WHERE id=$1", [first.response.entryId]);
    // The old successful request survives a later full class and changed identity.
    await pool.query("UPDATE class SET max_entries=3 WHERE id=$1", [f.classId]);
    const state = await mutableState(f.raceId);
    expect(await registerEntryAsAdmin(db, { ...input, request: { ...input.request, givenName: " Alva " } }, now))
      .toEqual({ status: "registered", response: { ...first.response, replayed: true } });
    expect((await registerEntryAsAdmin(db, { ...input, ...limited }, now)).status).toBe("conflict");
    expect((await registerEntryAsAdmin(db, { ...input, request: { ...input.request, givenName: "Other" } }, now)).status).toBe("conflict");
    expect(await mutableState(f.raceId)).toBe(state); expect(await preserved(f.raceId)).toBe(before);
    expect((await pool.query("SELECT actor_credential_id FROM entry_registration_request WHERE race_id=$1 ORDER BY snapshot_version_after", [f.raceId])).rows)
      .toEqual([{ actor_credential_id: f.administrator.actorId }, { actor_credential_id: limited.actorId }]);
    expect((await pool.query("SELECT actor_kind,actor_id FROM audit_event WHERE race_id=$1 AND action='ENTRY_REGISTERED_BY_ADMIN' ORDER BY actor_kind::text", [f.raceId])).rows)
      .toEqual([{ actor_kind: "ENTRY_REGISTRATION_ACCESS_CREDENTIAL", actor_id: limited.actorId },
        { actor_kind: "RACE_ADMIN_ACCESS_CREDENTIAL", actor_id: f.administrator.actorId }]);
    await expect(pool.query("UPDATE entry_registration_request SET created_at=created_at WHERE race_id=$1", [f.raceId])).rejects.toThrow();
  });

  it("rejects stale, forbidden, historically owned cards and full classes atomically; honors fixed starts", async () => {
    const f = await fixture(), reader = await auth(f.raceId, "VIEW_START_LIST"), input = await inputFor(f.administrator, f.classId);
    await pool.query("UPDATE card_assignment SET active=false WHERE race_id=$1", [f.raceId]);
    const before = await mutableState(f.raceId);
    expect((await registerEntryAsAdmin(db, { ...input, csrfHeader: null }, now)).status).toBe("forbidden");
    expect((await registerEntryAsAdmin(db, { ...input, ...reader }, now)).status).toBe("forbidden");
    for (const patch of [{ expectedSnapshotVersion: 2 }, { expectedCourseVersionId: randomUUID() }, { cardNumber: "12345" }]) {
      expect((await registerEntryAsAdmin(db, { ...input, request: { ...input.request, ...patch } }, now)).status).toBe("conflict");
    }
    expect(await mutableState(f.raceId)).toBe(before);
    await pool.query("UPDATE class SET max_entries=1 WHERE id=$1", [f.classId]);
    expect((await registerEntryAsAdmin(db, input, now)).status).toBe("conflict");
    expect(await mutableState(f.raceId)).toBe(before);
    await pool.query("UPDATE class SET max_entries=null,start_rule='FIXED' WHERE id=$1", [f.classId]);
    const fixed = await inputFor(f.administrator, f.classId);
    const changed = await registerEntryAsAdmin(db, fixed, now);
    if (changed.status !== "registered") throw new Error("Fixed registration failed");
    expect(changed.response.fixedStartTime).toBe("2026-09-12T10:05:00.000Z");
    expect((await pool.query("SELECT fixed_start_time FROM entry WHERE id=$1", [changed.response.entryId])).rows)
      .toEqual([{ fixed_start_time: new Date("2026-09-12T10:05:00Z") }]);
  });
});

