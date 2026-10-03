import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "@o-tid/database";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import { canonicalStartCheckinOperation, type StartCheckinOperation } from "@o-tid/contracts";
import { issueCheckinRecoveryGrant, revokeCheckinRecoveryGrant } from "../../src/checkin-recovery-grants";
import { syncStartCheckinWithRecovery } from "../../src/checkin-recovery-sync";
import { issuePairingAdminAccessCredential, loginPairingAdmin, revokePairingAdminAccessCredential } from "../../src/pairing-admin";
import { registerStartCheckinDeviceAsAdmin } from "../../src/start-checkin-device";
import { syncStartCheckinAsAdmin } from "../../src/start-checkin-sync";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const at = new Date("2026-09-05T10:00:00.000Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
const request = (operation: StartCheckinOperation) => ({ operation, contentHash: createHash("sha256").update(canonicalStartCheckinOperation(operation)).digest("hex") });

async function actor(raceId: string, capability: "START_CHECKIN" | "FINISH_FOREST_WATCH" = "START_CHECKIN") {
  const credential = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Synthetic operator",
    expiresAt: new Date("2026-09-05T18:00:00.000Z") }, { now: at });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: credential.accessCredential },
    { expectedRaceId: raceId, expectedCapability: capability, now: at });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  const auth = { raceId, capability, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const deviceId = randomUUID();
  expect((await registerStartCheckinDeviceAsAdmin(db, { ...auth, readBody: async () => ({ formatVersion: 1, deviceId, label: "Synthetic" }) }, () => at)).status).toBe("registered");
  return { auth, deviceId, credential };
}
async function setup() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID(), classId = randomUUID(), entryId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "Synthetic recovery sync", startsOn: "2026-09-05", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Synthetic", raceDate: "2026-09-05" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Synthetic" });
  await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
  await db.insert(schema.classes).values({ id: classId, raceId, courseVersionId, name: "Synthetic", startRule: "PUNCH" });
  await db.insert(schema.entries).values({ id: entryId, raceId, classId, givenName: "Synthetic", familyName: "Runner" });
  return { raceId, entryId, actor: await actor(raceId) };
}
function op(f: Awaited<ReturnType<typeof setup>>, overrides: Partial<StartCheckinOperation> = {}): StartCheckinOperation {
  return { formatVersion: 1, raceId: f.raceId, entryId: f.entryId, deviceId: f.actor.deviceId,
    actorCredentialId: f.actor.credential.credentialId, requestId: randomUUID(), localSequence: 1,
    packageVersion: 1, expectedEntryVersion: 1, expectedRevision: 0, dependsOnRequestId: null,
    observedAt: at.toISOString(), action: { kind: "MARK_START", state: "REPORTED_NOT_STARTED" }, ...overrides };
}
async function grant(f: Awaited<ReturnType<typeof setup>>, operations: StartCheckinOperation[]) {
  await revokePairingAdminAccessCredential(db, { credentialId: f.actor.credential.credentialId, capability: f.actor.auth.capability }, at);
  return issueCheckinRecoveryGrant(db, { manifest: { formatVersion: 1, kind: "OTID_CHECKIN_RECOVERY_MANIFEST", raceId: f.raceId,
    deviceId: f.actor.deviceId, actorCredentialId: f.actor.credential.credentialId, capability: f.actor.auth.capability,
    firstSequence: operations[0]!.localSequence, lastSequence: operations.at(-1)!.localSequence,
    items: operations.map(value => ({ requestId: value.requestId, localSequence: value.localSequence, contentHash: request(value).contentHash })) },
    operatorLabel: "Synthetic sponsor", reason: "Synthetic recovery", expiresAt: new Date("2026-09-05T11:00:00.000Z") }, { now: at });
}
const send = (token: string, operation: StartCheckinOperation) => syncStartCheckinWithRecovery(db, {
  raceId: operation.raceId, recoveryToken: token, readBody: async () => request(operation)
}, () => at);

describe("manifest-bound recovery delivery", () => {
  it("keeps ordinary auth revoked while concurrent recovery retries create one operation, DNS and delivery", async () => {
    const f = await setup(), operation = op(f), g = await grant(f, [operation]);
    const readBody = vi.fn(async () => request(operation));
    expect((await syncStartCheckinAsAdmin(db, { ...f.actor.auth, readBody }, () => at)).status).toBe("unauthorized");
    expect(readBody).not.toHaveBeenCalled();
    const [first, duplicate] = await Promise.all([send(g.token, operation), send(g.token, operation)]);
    expect(first).toEqual(duplicate);
    expect(first).toMatchObject({ status: "stored", response: { effect: { kind: "APPLIED", revision: 1 } } });
    for (const table of [schema.startCheckinOperations, schema.startCheckinDnsDecisions, schema.checkinRecoveryDeliveries]) {
      expect(await db.select().from(table).where(eq(table.raceId, f.raceId))).toHaveLength(1);
    }
    expect(await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.entityId, operation.requestId),
      eq(schema.auditEvents.action, "CHECKIN_RECOVERY_OPERATION_DELIVERED")))).toHaveLength(1);
    const [saved] = await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.requestId, operation.requestId));
    expect(saved?.actorCredentialId).toBe(f.actor.credential.credentialId);
  });

  it("recovers an already committed ordinary receipt without replacing its original time or actor", async () => {
    const f = await setup(), operation = op(f);
    const original = await syncStartCheckinAsAdmin(db, { ...f.actor.auth, readBody: async () => request(operation) }, () => at);
    const g = await grant(f, [operation]);
    expect(await send(g.token, operation)).toEqual(original);
    expect(await send(g.token, operation)).toEqual(original);
    expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, f.raceId))).toHaveLength(1);
    expect(await db.select().from(schema.checkinRecoveryDeliveries).where(eq(schema.checkinRecoveryDeliveries.grantId, g.grantId))).toHaveLength(1);
  });

  it("authenticates before body and rejects altered token, other scope and unlisted or rehashed operations", async () => {
    const f = await setup(), operation = op(f), g = await grant(f, [operation]);
    const readBody = vi.fn(async () => request(operation));
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const alias = g.token.slice(0, -1) + alphabet[alphabet.indexOf(g.token.at(-1)!) + 1];
    for (const token of [undefined, "invalid", alias, g.token.slice(0, -1) + "!", g.token.replace(/\.[^.]+$/, "." + "A".repeat(43))]) {
      expect((await syncStartCheckinWithRecovery(db, { raceId: f.raceId, recoveryToken: token, readBody }, () => at)).status).toBe("unauthorized");
    }
    expect((await syncStartCheckinWithRecovery(db, { raceId: randomUUID(), recoveryToken: g.token, readBody }, () => at)).status).toBe("unauthorized");
    expect(readBody).not.toHaveBeenCalled();
    expect((await send(g.token, { ...operation, requestId: randomUUID() })).status).toBe("forbidden");
    expect((await send(g.token, { ...operation, action: { kind: "MARK_START", state: "STARTED" } })).status).toBe("forbidden");
    expect((await send(g.token, { ...operation, deviceId: randomUUID() })).status).toBe("forbidden");
    expect((await syncStartCheckinWithRecovery(db, { raceId: f.raceId, recoveryToken: g.token,
      readBody: async () => ({ ...request(operation), contentHash: "a".repeat(64) }) }, () => at)).status).toBe("invalid-request");
    expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, f.raceId))).toHaveLength(0);
  });

  it("rechecks revocation and expiry after consuming the body", async () => {
    const f = await setup(), operation = op(f), g = await grant(f, [operation]);
    expect((await syncStartCheckinWithRecovery(db, { raceId: f.raceId, recoveryToken: g.token, readBody: async () => {
      await revokeCheckinRecoveryGrant(db, { grantId: g.grantId, operatorLabel: "Synthetic", reason: "Revoke during body" }, at);
      return request(operation);
    } }, () => at)).status).toBe("unauthorized");
    const second = await grant(f, [operation]);
    let clock = at;
    expect((await syncStartCheckinWithRecovery(db, { raceId: f.raceId, recoveryToken: second.token, readBody: async () => {
      clock = new Date(second.expiresAt); return request(operation);
    } }, () => clock)).status).toBe("unauthorized");
    expect(await db.select().from(schema.checkinRecoveryDeliveries).where(eq(schema.checkinRecoveryDeliveries.raceId, f.raceId))).toHaveLength(0);
  });

  it("keeps late negative and dependent reports as conflicts after a registered return", async () => {
    const f = await setup(), finish = await actor(f.raceId, "FINISH_FOREST_WATCH");
    const returned = op(f, { deviceId: finish.deviceId, actorCredentialId: finish.credential.credentialId,
      action: { kind: "FINISH_CORRECTION", state: "STARTED", manualReturnRegistered: true } });
    expect((await syncStartCheckinAsAdmin(db, { ...finish.auth, readBody: async () => request(returned) }, () => at)).status).toBe("stored");
    const late = op(f, { expectedRevision: 1 }), dependent = op(f, { localSequence: 2, expectedRevision: 2, dependsOnRequestId: late.requestId });
    const g = await grant(f, [late, dependent]);
    expect(await send(g.token, late)).toMatchObject({ status: "stored", response: { effect: { kind: "CONFLICT", reason: "RETURN_ALREADY_REGISTERED" } } });
    expect(await send(g.token, dependent)).toMatchObject({ status: "stored", response: { effect: { kind: "CONFLICT", reason: "DEPENDENCY_CONFLICT" } } });
    expect(await db.select().from(schema.startCheckinDnsDecisions).where(eq(schema.startCheckinDnsDecisions.raceId, f.raceId))).toHaveLength(0);
    expect(await db.select().from(schema.checkinRecoveryDeliveries).where(eq(schema.checkinRecoveryDeliveries.grantId, g.grantId))).toHaveLength(2);
  });

  it("waits behind a revocation row lock and rejects after that revocation commits", async () => {
    const f = await setup(), operation = op(f), g = await grant(f, [operation]);
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const revocation = db.transaction(async (tx) => {
      await tx.select().from(schema.checkinRecoveryGrants).where(eq(schema.checkinRecoveryGrants.id, g.grantId)).for("update");
      await tx.insert(schema.checkinRecoveryGrantRevocations).values({ grantId: g.grantId, operatorLabel: "Synthetic", reason: "Lock race", revokedAt: at });
      locked(); await gate;
    });
    await ready;
    const delivery = send(g.token, operation);
    try {
      await vi.waitFor(async () => {
        const waiting = await pool.query("select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%checkin_recovery_grant%for share%'");
        expect(waiting.rowCount).toBeGreaterThan(0);
      }, { timeout: 3000, interval: 10 });
    } finally { release(); }
    await revocation;
    expect((await delivery).status).toBe("unauthorized");
    expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, f.raceId))).toHaveLength(0);
  });

  it("commits an already authorized delivery before a concurrent grant revocation", async () => {
    const f = await setup(), operation = op(f), g = await grant(f, [operation]);
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const deviceLock = db.transaction(async (tx) => {
      await tx.select().from(schema.startCheckinDevices).where(eq(schema.startCheckinDevices.id, f.actor.deviceId)).for("update");
      locked(); await gate;
    });
    await ready;
    const delivery = send(g.token, operation);
    let revocation: ReturnType<typeof revokeCheckinRecoveryGrant> | undefined;
    try {
      await vi.waitFor(async () => {
        const waiting = await pool.query("select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%start_checkin_device%for update%'");
        expect(waiting.rowCount).toBeGreaterThan(0);
      }, { timeout: 3000, interval: 10 });
      revocation = revokeCheckinRecoveryGrant(db, { grantId: g.grantId, operatorLabel: "Synthetic", reason: "Concurrent revocation" }, at);
      await vi.waitFor(async () => {
        const waiting = await pool.query("select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%checkin_recovery_grant%for update%'");
        expect(waiting.rowCount).toBeGreaterThan(0);
      }, { timeout: 3000, interval: 10 });
    } finally { release(); }
    await deviceLock;
    expect((await delivery).status).toBe("stored");
    await revocation;
    expect((await send(g.token, operation)).status).toBe("unauthorized");
    expect(await db.select().from(schema.checkinRecoveryDeliveries).where(eq(schema.checkinRecoveryDeliveries.grantId, g.grantId))).toHaveLength(1);
  });

  it("rolls back the original operation, DNS and delivery if recovery audit fails", async () => {
    const f = await setup(), operation = op(f), g = await grant(f, [operation]);
    await db.execute(sql`CREATE FUNCTION otid_test_recovery_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'CHECKIN_RECOVERY_OPERATION_DELIVERED' THEN RAISE EXCEPTION 'synthetic recovery audit failure'; END IF; RETURN NEW; END $$`);
    await db.execute(sql`CREATE TRIGGER otid_test_recovery_audit_failure BEFORE INSERT ON audit_event
      FOR EACH ROW EXECUTE FUNCTION otid_test_recovery_audit_failure()`);
    try {
      await expect(send(g.token, operation)).rejects.toThrow();
      for (const table of [schema.startCheckinOperations, schema.startCheckinRevisions, schema.resultRevisions, schema.startCheckinDnsDecisions, schema.checkinRecoveryDeliveries]) {
        expect(await db.select().from(table).where(eq(table.raceId, f.raceId))).toHaveLength(0);
      }
    } finally {
      await db.execute(sql`DROP TRIGGER otid_test_recovery_audit_failure ON audit_event`);
      await db.execute(sql`DROP FUNCTION otid_test_recovery_audit_failure()`);
    }
    expect((await send(g.token, operation)).status).toBe("stored");
  });
});
