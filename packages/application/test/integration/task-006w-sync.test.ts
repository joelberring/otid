import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { eq, sql } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import { canonicalStartCheckinOperation, type StartCheckinOperation } from "@o-tid/contracts";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { registerStartCheckinDeviceAsAdmin } from "../../src/start-checkin-device";
import { syncStartCheckinAsAdmin } from "../../src/start-checkin-sync";
import { publicResults } from "../../src/results";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/hash";
import { listStartCheckinRosterAsAdmin } from "../../src/start-checkin-roster";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const at = new Date("2026-09-05T10:00:00.000Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function admin(raceId: string, capability: "START_CHECKIN" | "FINISH_FOREST_WATCH" = "START_CHECKIN") {
  const credential = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Synthetic operator",
    expiresAt: new Date("2026-09-05T18:00:00.000Z") }, { now: at });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: credential.accessCredential },
    { expectedRaceId: raceId, expectedCapability: capability, now: at });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  const auth = { raceId, capability, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const deviceId = randomUUID();
  expect((await registerStartCheckinDeviceAsAdmin(db, { ...auth, readBody: async () => ({ formatVersion: 1, deviceId, label: "Testmobil" }) }, () => at)).status).toBe("registered");
  return { auth, deviceId, credential };
}
async function setup() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), versionId = randomUUID(), classId = randomUUID(), entryId = randomUUID(), controlId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "Synthetic sync", startsOn: "2026-09-05", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Test", raceDate: "2026-09-05" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Testbana" });
  await db.insert(schema.courseVersions).values({ id: versionId, courseId, version: 1 });
  await db.insert(schema.controls).values({ id: controlId, raceId, code: 31 });
  await db.insert(schema.courseControls).values({ courseVersionId: versionId, controlId, sequence: 1 });
  await db.insert(schema.classes).values({ id: classId, raceId, name: "Testklass", courseVersionId: versionId, startRule: "PUNCH" });
  await db.insert(schema.entries).values({ id: entryId, raceId, classId, givenName: "Test", familyName: "Löpare" });
  await db.insert(schema.cardAssignments).values({ raceId, entryId, cardNumber: "12345" });
  return { raceId, entryId, actor: await admin(raceId) };
}
function operation(f: Awaited<ReturnType<typeof setup>>, sequence: number, expectedRevision: number,
  state: "UNMARKED" | "STARTED" | "REPORTED_NOT_STARTED", overrides: Partial<StartCheckinOperation> = {}): StartCheckinOperation {
  return { formatVersion: 1, requestId: randomUUID(), dependsOnRequestId: null, deviceId: f.actor.deviceId,
    actorCredentialId: f.actor.credential.credentialId, raceId: f.raceId, entryId: f.entryId,
    localSequence: sequence, packageVersion: 1, expectedEntryVersion: 1, expectedRevision,
    observedAt: at.toISOString(), action: { kind: "MARK_START", state }, ...overrides };
}
function send(actor: Awaited<ReturnType<typeof admin>>, op: StartCheckinOperation) {
  return syncStartCheckinAsAdmin(db, { ...actor.auth, readBody: async () => ({ operation: op,
    contentHash: createHash("sha256").update(canonicalStartCheckinOperation(op)).digest("hex") }) }, () => at);
}
async function readCard(raceId: string) {
  const payload = { cardNumber: "12345", startPunchedAt: "2026-09-05T10:00:00Z", finishPunchedAt: "2026-09-05T10:30:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-05T10:15:00Z" }] };
  return ingestDeviceBatch(db, raceId, { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: 1,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-05T10:31:00Z",
      transport: "simulator", payload, contentHash: contentHash(payload) }] });
}

describe("TASK 006W authenticated atomic checkin sync", () => {
  it("projects every roster entry with mixed starts, explicit return and persistent conflict uncertainty", async () => {
    const f = await setup();
    const [raceClass] = await db.select().from(schema.classes).where(eq(schema.classes.raceId, f.raceId));
    if (!raceClass) throw new Error("Missing class");
    const fixedClassId = randomUUID(), fixedEntryId = randomUUID();
    await db.insert(schema.classes).values({ id: fixedClassId, raceId: f.raceId, name: "Fast start", startRule: "FIXED", courseVersionId: raceClass.courseVersionId });
    await db.insert(schema.entries).values({ id: fixedEntryId, raceId: f.raceId, classId: fixedClassId, givenName: "Fast", familyName: "Löpare", fixedStartTime: at });
    const roster = async () => {
      const result = await listStartCheckinRosterAsAdmin(db, f.actor.auth, at);
      if (result.status !== "ok") throw new Error("Missing roster");
      return result.response;
    };
    const initial = await roster();
    expect(initial.knowledge).toBe("LAST_SYNCED_ONLY");
    expect(initial.entries).toHaveLength(2);
    expect(initial.entries.find(e => e.entryId === fixedEntryId)).toMatchObject({ startRule: "FIXED", fixedStartTime: at.toISOString(), revision: 0, forestState: "UNCONFIRMED", needsFollowUp: true });
    expect(initial.entries.find(e => e.entryId === f.entryId)).toMatchObject({ startRule: "PUNCH", fixedStartTime: null, cardNumber: "12345", forestState: "UNCONFIRMED" });
    expect(initial.devices[0]).toMatchObject({ lastSequence: 0, lastReceivedAt: null });
    await send(f.actor, operation(f, 1, 0, "STARTED"));
    expect((await roster()).entries.find(e => e.entryId === f.entryId)?.forestState).toBe("STARTED_NO_RETURN");
    await send(f.actor, operation(f, 2, 1, "REPORTED_NOT_STARTED"));
    expect((await roster()).entries.find(e => e.entryId === f.entryId)).toMatchObject({ activeDns: true, forestState: "NOT_STARTED", needsFollowUp: false });
    const finish = await admin(f.raceId, "FINISH_FOREST_WATCH");
    await send(finish, operation(f, 1, 2, "UNMARKED", { deviceId: finish.deviceId, actorCredentialId: finish.credential.credentialId,
      action: { kind: "FINISH_CORRECTION", state: "UNMARKED", manualReturnRegistered: true } }));
    expect((await roster()).entries.find(e => e.entryId === f.entryId)).toMatchObject({ activeDns: false, manualReturnRegistered: true, forestState: "RETURNED" });
    await send(f.actor, operation(f, 3, 3, "REPORTED_NOT_STARTED"));
    const conflicted = await roster();
    expect(conflicted.entries.find(e => e.entryId === f.entryId)).toMatchObject({ manualReturnRegistered: true, conflictingReports: true, forestState: "CONFLICT", needsFollowUp: true });
    expect(conflicted.devices.find(d => d.deviceId === f.actor.deviceId)).toMatchObject({ lastSequence: 3, lastReceivedAt: at.toISOString() });
    expect(await listStartCheckinRosterAsAdmin(db, finish.auth, at)).toMatchObject({ status: "ok", response: conflicted });
    expect(JSON.stringify(conflicted)).not.toContain(f.actor.credential.credentialId);
    expect(JSON.stringify(conflicted)).not.toContain("contentHash");
  });

  it("reads actual return without result inference, is private and makes no writes", async () => {
    const f = await setup(), other = await setup();
    await readCard(f.raceId);
    const before = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, f.raceId));
    const result = await listStartCheckinRosterAsAdmin(db, f.actor.auth, at);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("Missing roster");
    expect(result.response.entries[0]).toMatchObject({ revision: 0, startState: "UNMARKED", readoutReturnRegistered: true, forestState: "RETURNED", needsFollowUp: false });
    expect((await listStartCheckinRosterAsAdmin(db, { ...f.actor.auth, raceId: other.raceId }, at)).status).not.toBe("ok");
    expect((await listStartCheckinRosterAsAdmin(db, { ...f.actor.auth, sessionToken: "invalid" }, at)).status).toBe("unauthorized");
    expect(await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, f.raceId))).toEqual(before);
    expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, f.raceId))).toHaveLength(0);
  });

  it("rolls back journal, operational revision and DNS together when audit fails", async () => {
    const f = await setup(), op = operation(f, 1, 0, "REPORTED_NOT_STARTED");
    await db.execute(sql`CREATE FUNCTION otid_test_006w_fail_sync_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'START_CHECKIN_OPERATION_STORED' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await db.execute(sql`CREATE TRIGGER otid_test_006w_fail_sync_audit BEFORE INSERT ON audit_event
      FOR EACH ROW EXECUTE FUNCTION otid_test_006w_fail_sync_audit()`);
    try {
      await expect(send(f.actor, op)).rejects.toThrow();
      for (const table of [schema.startCheckinOperations, schema.startCheckinRevisions, schema.startCheckinDnsDecisions, schema.resultRevisions]) {
        expect(await db.select().from(table).where(eq(table.raceId, f.raceId))).toHaveLength(0);
      }
    } finally {
      await db.execute(sql`DROP TRIGGER otid_test_006w_fail_sync_audit ON audit_event`);
      await db.execute(sql`DROP FUNCTION otid_test_006w_fail_sync_audit()`);
    }
    expect(await send(f.actor, op)).toMatchObject({ status: "stored", response: { effect: { kind: "APPLIED" } } });
  });

  it("serializes competing devices and concurrent readout without losing a result", async () => {
    const f = await setup(), second = await admin(f.raceId);
    const responses = await Promise.all([
      send(f.actor, operation(f, 1, 0, "STARTED")),
      send(second, operation(f, 1, 0, "REPORTED_NOT_STARTED", { deviceId: second.deviceId, actorCredentialId: second.credential.credentialId }))
    ]);
    expect(responses.filter(r => r.status === "stored" && r.response.effect.kind === "APPLIED")).toHaveLength(1);
    expect(responses.filter(r => r.status === "stored" && r.response.effect.kind === "CONFLICT")).toHaveLength(1);
    const other = await setup();
    await Promise.all([send(other.actor, operation(other, 1, 0, "REPORTED_NOT_STARTED")), readCard(other.raceId)]);
    expect((await publicResults(db, other.raceId)).results[0]?.status).toBe("OK");
    expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, other.raceId))).toHaveLength(1);
  });

  it("replays from a fresh session but rechecks expiration after body consumption", async () => {
    const f = await setup(), op = operation(f, 1, 0, "STARTED"), saved = await send(f.actor, op);
    const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: f.actor.credential.accessCredential },
      { expectedRaceId: f.raceId, expectedCapability: "START_CHECKIN", now: at });
    if (login.status !== "authenticated") throw new Error("Fresh login failed");
    expect(await send({ ...f.actor, auth: { ...f.actor.auth, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken } }, op)).toEqual(saved);
    let now = at;
    const next = operation(f, 2, 1, "REPORTED_NOT_STARTED");
    const response = await syncStartCheckinAsAdmin(db, { ...f.actor.auth, readBody: async () => {
      now = new Date("2026-09-05T19:00:00.000Z");
      return { operation: next, contentHash: createHash("sha256").update(canonicalStartCheckinOperation(next)).digest("hex") };
    } }, () => now);
    expect(response.status).toBe("unauthorized");
    expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, f.raceId))).toHaveLength(1);
  });

  it("creates DNS once under concurrent retries, withdraws it and allows a new explicit DNS", async () => {
    const f = await setup(), op = operation(f, 1, 0, "REPORTED_NOT_STARTED");
    const responses = await Promise.all(Array.from({ length: 12 }, () => send(f.actor, op)));
    expect(responses.every(r => JSON.stringify(r) === JSON.stringify(responses[0]))).toBe(true);
    expect(responses[0]).toMatchObject({ status: "stored", response: { effect: { kind: "APPLIED", revision: 1 } } });
    expect((await publicResults(db, f.raceId)).results[0]?.status).toBe("DNS");
    expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, f.raceId))).toHaveLength(1);
    expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, f.raceId))).toHaveLength(0);
    const correction = operation(f, 2, 1, "STARTED", { dependsOnRequestId: op.requestId });
    expect(await send(f.actor, correction)).toMatchObject({ status: "stored", response: { effect: { kind: "APPLIED", revision: 2 } } });
    expect((await publicResults(db, f.raceId)).results).toEqual([]);
    expect(await send(f.actor, operation(f, 3, 2, "REPORTED_NOT_STARTED", { dependsOnRequestId: correction.requestId })))
      .toMatchObject({ status: "stored", response: { effect: { kind: "APPLIED", revision: 3 } } });
    expect((await publicResults(db, f.raceId)).results[0]).toMatchObject({ status: "DNS", revision: 2 });
    expect(await send(f.actor, op)).toEqual(responses[0]);
  });

  it("persists stale/dependency conflicts, rejects sequence reuse and never rebases a failed predecessor", async () => {
    const f = await setup(), stale = operation(f, 1, 0, "STARTED", { expectedEntryVersion: 2 });
    expect(await send(f.actor, stale)).toMatchObject({ status: "stored", response: { effect: { kind: "CONFLICT", reason: "STALE_ENTRY" } } });
    expect(await send(f.actor, operation(f, 2, 0, "REPORTED_NOT_STARTED", { dependsOnRequestId: stale.requestId })))
      .toMatchObject({ status: "stored", response: { effect: { kind: "CONFLICT", reason: "DEPENDENCY_CONFLICT" } } });
    expect(await send(f.actor, operation(f, 2, 0, "STARTED"))).toEqual({ status: "conflict" });
    expect(await send(f.actor, operation(f, 4, 0, "STARTED"))).toEqual({ status: "conflict" });
    expect(await db.select().from(schema.startCheckinRevisions).where(eq(schema.startCheckinRevisions.raceId, f.raceId))).toHaveLength(0);
    expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, f.raceId))).toHaveLength(0);
  });

  it("accepts unmarked as unchanged, preserves manual return and rejects late negative reports", async () => {
    const f = await setup();
    expect(await send(f.actor, operation(f, 1, 0, "UNMARKED"))).toMatchObject({ status: "stored", response: { effect: { kind: "UNCHANGED", revision: 0 } } });
    const finish = await admin(f.raceId, "FINISH_FOREST_WATCH");
    const returned = operation(f, 1, 0, "STARTED", { deviceId: finish.deviceId, actorCredentialId: finish.credential.credentialId,
      action: { kind: "FINISH_CORRECTION", state: "STARTED", manualReturnRegistered: true } });
    expect(await send(finish, returned)).toMatchObject({ status: "stored", response: { effect: { kind: "APPLIED", revision: 1 } } });
    expect(await send(f.actor, operation(f, 2, 1, "REPORTED_NOT_STARTED"))).toMatchObject({ status: "stored",
      response: { effect: { kind: "CONFLICT", reason: "RETURN_ALREADY_REGISTERED" } } });
    expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, f.raceId))).toHaveLength(0);
  });

  it("keeps real readouts authoritative regardless of whether DNS or ingest arrives first", async () => {
    for (const dnsFirst of [true, false]) {
      const f = await setup();
      if (dnsFirst) await send(f.actor, operation(f, 1, 0, "REPORTED_NOT_STARTED"));
      await readCard(f.raceId);
      const response = await send(f.actor, operation(f, dnsFirst ? 2 : 1, dnsFirst ? 1 : 0, "REPORTED_NOT_STARTED"));
      expect(response).toMatchObject({ status: "stored", response: { effect: { kind: "CONFLICT", reason: "RETURN_ALREADY_REGISTERED" } } });
      expect((await publicResults(db, f.raceId)).results[0]?.status).toBe("OK");
    }
  });

  it("authenticates before body and rejects wrong roles or hashes without a journal entry", async () => {
    const f = await setup();
    const result = await syncStartCheckinAsAdmin(db, { ...f.actor.auth, csrfHeader: "invalid", readBody: async () => { throw new Error("Body must not be read"); } }, () => at);
    expect(result.status).toBe("forbidden");
    expect(await send(f.actor, operation(f, 1, 0, "STARTED", { action: { kind: "FINISH_CORRECTION", state: "STARTED", manualReturnRegistered: true } })))
      .toEqual({ status: "forbidden" });
    expect(await syncStartCheckinAsAdmin(db, { ...f.actor.auth, readBody: async () => ({ operation: operation(f, 1, 0, "STARTED"), contentHash: "0".repeat(64) }) }, () => at))
      .toEqual({ status: "invalid-request" });
    expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, f.raceId))).toHaveLength(0);
  });
});
