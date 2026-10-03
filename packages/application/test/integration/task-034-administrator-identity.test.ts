import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import { listEntryIdentitiesAsAdmin, changeEntryIdentityAsAdmin } from "../../src/entry-identity";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/hash";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-12T14:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
async function auth(raceId: string, capability: "MANAGE_RACE" | "CHANGE_ENTRY_IDENTITY" | "VIEW_START_LIST" = "MANAGE_RACE") {
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

async function inputFor(actor: Awaited<ReturnType<typeof auth>>, entryId: string) {
  const list = await listEntryIdentitiesAsAdmin(db, actor, now);
  if (list.status !== "ok") throw new Error("Identity list failed");
  const entry = list.response.entries.find(row => row.id === entryId);
  if (!entry) throw new Error("Missing identity");
  return { ...actor, entryId, idempotencyKey: `entry-identity-change:${randomUUID()}`,
    request: { formatVersion: 1, expectedEntryVersion: entry.version, expectedClassId: entry.classId,
      expectedSnapshotVersion: list.response.snapshotVersion, expectedIdentity: entry.identity,
      identity: { givenName: "Alva", familyName: "Synthetic corrected", organisationName: "Synthetic OK" } } };
}
async function preserved(raceId: string) {
  const raw = (await pool.query("SELECT * FROM raw_device_message WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const results = (await pool.query("SELECT * FROM result_revision WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const readouts = (await pool.query("SELECT * FROM card_readout WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const cards = (await pool.query("SELECT * FROM card_assignment WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const classes = (await pool.query("SELECT * FROM class WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ raw, results, readouts, cards, classes });
}
describe("TASK034 administrator identity correction", () => {
  it("records genuine role/actor, retains old exact retry and preserves raw/results/assignments", async () => {
    const f = await fixture(), limited = await auth(f.raceId, "CHANGE_ENTRY_IDENTITY");
    const input = await inputFor(f.administrator, f.entryId), before = await preserved(f.raceId);
    const changed = await changeEntryIdentityAsAdmin(db, input, now);
    if (changed.status !== "changed") throw new Error("Identity correction failed");
    expect(changed.response).toMatchObject({ entryVersionBefore: 1, entryVersionAfter: 2,
      snapshotVersionBefore: 1, snapshotVersionAfter: 2, previousIdentity: input.request.expectedIdentity,
      identity: input.request.identity });
    const next = await inputFor(limited, f.entryId);
    next.request.identity.givenName = "Alice";
    expect((await changeEntryIdentityAsAdmin(db, next, now)).status).toBe("changed");
    expect(await changeEntryIdentityAsAdmin(db, { ...input, request: { ...input.request,
      identity: { ...input.request.identity, givenName: " Alva " } } }, now))
      .toEqual({ status: "changed", response: { ...changed.response, replayed: true } });
    expect((await changeEntryIdentityAsAdmin(db, { ...input, ...limited }, now)).status).toBe("conflict");
    expect((await changeEntryIdentityAsAdmin(db, { ...input, request: { ...input.request,
      identity: { ...input.request.identity, givenName: "Other" } } }, now)).status).toBe("conflict");
    expect(await preserved(f.raceId)).toBe(before);
    expect((await pool.query("SELECT capability,actor_credential_id FROM entry_identity_change_request WHERE race_id=$1 ORDER BY entry_version_before", [f.raceId])).rows)
      .toEqual([{ capability: "MANAGE_RACE", actor_credential_id: f.administrator.actorId },
        { capability: "CHANGE_ENTRY_IDENTITY", actor_credential_id: limited.actorId }]);
    expect((await pool.query("SELECT actor_kind,actor_id FROM audit_event WHERE race_id=$1 AND action='ENTRY_IDENTITY_CHANGED_BY_ADMIN' ORDER BY actor_kind::text", [f.raceId])).rows)
      .toEqual([{ actor_kind: "ENTRY_IDENTITY_ACCESS_CREDENTIAL", actor_id: limited.actorId },
        { actor_kind: "RACE_ADMIN_ACCESS_CREDENTIAL", actor_id: f.administrator.actorId }]);
    await expect(pool.query("UPDATE entry_identity_change_request SET changed_at=changed_at WHERE race_id=$1", [f.raceId])).rejects.toThrow();
  });

  it("retains stale/noop/CSRF/limited-role protection and the composite actor-capability FK", async () => {
    const f = await fixture(), reader = await auth(f.raceId, "VIEW_START_LIST"), input = await inputFor(f.administrator, f.entryId);
    expect((await changeEntryIdentityAsAdmin(db, { ...input, csrfHeader: null }, now)).status).toBe("forbidden");
    expect((await changeEntryIdentityAsAdmin(db, { ...input, ...reader }, now)).status).toBe("forbidden");
    expect((await listEntryIdentitiesAsAdmin(db, reader, now)).status).toBe("forbidden");
    for (const patch of [{ expectedEntryVersion: 2 }, { expectedSnapshotVersion: 2 }, { identity: input.request.expectedIdentity },
      { expectedIdentity: { ...input.request.expectedIdentity, givenName: "Wrong" } }]) {
      expect((await changeEntryIdentityAsAdmin(db, { ...input, request: { ...input.request, ...patch } }, now)).status).toBe("conflict");
    }
    // Both roles are now allowed by the CHECK, but cannot be mislabeled across the actor FK.
    await expect(pool.query(`INSERT INTO entry_identity_change_request(request_id,race_id,entry_id,class_id,
      actor_credential_id,capability,previous_identity,identity,entry_version_before,entry_version_after,
      snapshot_version_before,snapshot_version_after)
      VALUES($1,$2,$3,$4,$5,'CHANGE_ENTRY_IDENTITY',$6,$7,1,2,1,2)`,
      [randomUUID(), f.raceId, f.entryId, f.classId, f.administrator.actorId,
        JSON.stringify(input.request.expectedIdentity), JSON.stringify(input.request.identity)]))
      .rejects.toMatchObject({ constraint: "entry_identity_change_actor_scope_fk", code: "23503" });
    expect((await pool.query("SELECT * FROM entry_identity_change_request WHERE race_id=$1", [f.raceId])).rowCount).toBe(0);
    expect((await pool.query("SELECT version FROM entry WHERE id=$1", [f.entryId])).rows).toEqual([{ version: 1 }]);
    expect((await pool.query("SELECT snapshot_version FROM race WHERE id=$1", [f.raceId])).rows).toEqual([{ snapshot_version: 1 }]);
  });
});

