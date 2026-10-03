import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, sql } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import { canonicalStartCheckinOperation, StartCheckinReceiptSchema } from "@o-tid/contracts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const at = new Date("2026-09-05T08:00:00.000Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

// Storage tests, not authentication/usecase acceptance. All fixtures are synthetic.
async function setup(capability: "START_CHECKIN" | "FINISH_FOREST_WATCH" = "START_CHECKIN") {
  const f = { eventId: randomUUID(), raceId: randomUUID(), courseId: randomUUID(), courseVersionId: randomUUID(),
    classId: randomUUID(), entryId: randomUUID(), actorCredentialId: randomUUID(), deviceId: randomUUID(), capability };
  await db.transaction(async (tx) => {
    await tx.insert(schema.events).values({ id: f.eventId, name: "Syntetisk skogskontroll", startsOn: "2026-09-05", timeZone: "Europe/Stockholm" });
    await tx.insert(schema.races).values({ id: f.raceId, eventId: f.eventId, name: "Testlopp", raceDate: "2026-09-05" });
    await tx.insert(schema.courses).values({ id: f.courseId, raceId: f.raceId, name: "Testbana" });
    await tx.insert(schema.courseVersions).values({ id: f.courseVersionId, courseId: f.courseId, version: 1 });
    await tx.insert(schema.classes).values({ id: f.classId, raceId: f.raceId, courseVersionId: f.courseVersionId, name: "Testklass" });
    await tx.insert(schema.entries).values({ id: f.entryId, raceId: f.raceId, classId: f.classId, givenName: "Test", familyName: "Löpare" });
    await tx.insert(schema.pairingAdminAccessCredentials).values({ id: f.actorCredentialId, raceId: f.raceId, capability,
      label: "Synthetic operator", secretHash: "a".repeat(64), issuedAt: at, expiresAt: new Date("2026-09-05T16:00:00.000Z") });
    await tx.insert(schema.startCheckinDevices).values({ id: f.deviceId, raceId: f.raceId, actorCredentialId: f.actorCredentialId,
      capability, label: "Testmobil", registeredAt: at });
  });
  return f;
}

function journal(f: Awaited<ReturnType<typeof setup>>, overrides: Partial<typeof schema.startCheckinOperations.$inferInsert> = {}) {
  const operation = { formatVersion: 1, requestId: randomUUID(), deviceId: f.deviceId, actorCredentialId: f.actorCredentialId,
    raceId: f.raceId, entryId: f.entryId, localSequence: 1, packageVersion: 1, expectedEntryVersion: 1, expectedRevision: 0,
    dependsOnRequestId: null, observedAt: at.toISOString(), action: { kind: "MARK_START", state: "UNMARKED" } };
  const contentHash = createHash("sha256").update(canonicalStartCheckinOperation(operation)).digest("hex");
  const receipt = StartCheckinReceiptSchema.parse({ formatVersion: 1, storage: "STORED", requestId: operation.requestId,
    deviceId: f.deviceId, raceId: f.raceId, entryId: f.entryId, localSequence: 1, contentHash,
    receivedAt: at.toISOString(), effect: { kind: "UNCHANGED", revision: 0 } });
  const result: typeof schema.startCheckinOperations.$inferInsert = {
    requestId: operation.requestId, deviceId: f.deviceId, actorCredentialId: f.actorCredentialId,
    raceId: f.raceId, entryId: f.entryId, localSequence: 1, packageVersion: 1, expectedEntryVersion: 1, expectedRevision: 0,
    contentHash, intent: operation, observedAt: at, receivedAt: at, effect: "UNCHANGED", resultingRevision: 0,
    createdRevisionId: null, conflictReason: null, receipt, ...overrides
  };
  return result;
}

function applied(f: Awaited<ReturnType<typeof setup>>) {
  const revisionId = randomUUID();
  const operation = journal(f, { effect: "APPLIED", resultingRevision: 1, createdRevisionId: revisionId });
  operation.intent = { ...operation.intent, action: { kind: "MARK_START", state: "STARTED" } };
  operation.contentHash = createHash("sha256").update(canonicalStartCheckinOperation(operation.intent)).digest("hex");
  operation.receipt = { ...operation.receipt, contentHash: operation.contentHash, effect: { kind: "APPLIED", revisionId, revision: 1 } };
  const revision: typeof schema.startCheckinRevisions.$inferInsert = { id: revisionId, requestId: operation.requestId,
    raceId: f.raceId, entryId: f.entryId, revision: 1, startState: "STARTED", manualReturnRegistered: false };
  return { operation, revision };
}

describe("TASK 006W PostgreSQL journal substrate", () => {
  it("stores a reciprocal operation/revision atomically, with no raw or result fabrication", async () => {
    const f = await setup(), rows = applied(f);
    await db.transaction(async (tx) => {
      await tx.insert(schema.startCheckinRevisions).values(rows.revision);
      await tx.insert(schema.startCheckinOperations).values(rows.operation);
    });
    expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.requestId, rows.operation.requestId)))
      .toEqual([rows.operation]);
    expect(await db.select().from(schema.startCheckinRevisions).where(eq(schema.startCheckinRevisions.id, rows.revision.id)))
      .toEqual([{ ...rows.revision, operationEffect: "APPLIED" }]);
    expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, f.raceId))).toHaveLength(0);
    expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, f.raceId))).toHaveLength(0);
  });

  it("rejects missing/mismatched reciprocal revisions at commit and leaves no partial operation", async () => {
    const f = await setup();
    for (const mismatch of ["missing", "request", "entry", "revision"] as const) {
      const rows = applied(f);
      await expect(db.transaction(async (tx) => {
        await tx.insert(schema.startCheckinOperations).values(rows.operation);
        if (mismatch !== "missing") await tx.insert(schema.startCheckinRevisions).values({ ...rows.revision,
          ...(mismatch === "request" ? { requestId: randomUUID() } : {}),
          ...(mismatch === "entry" ? { entryId: randomUUID() } : {}),
          ...(mismatch === "revision" ? { revision: 2 } : {}) });
      })).rejects.toThrow();
      expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.requestId, rows.operation.requestId))).toHaveLength(0);
      expect(await db.select().from(schema.startCheckinRevisions).where(eq(schema.startCheckinRevisions.id, rows.revision.id))).toHaveLength(0);
    }
  });

  it("rolls back journal and revision after a later transaction failure", async () => {
    const f = await setup(), rows = applied(f);
    await expect(db.transaction(async (tx) => {
      await tx.insert(schema.startCheckinOperations).values(rows.operation);
      await tx.insert(schema.startCheckinRevisions).values(rows.revision);
      throw new Error("synthetic late failure");
    })).rejects.toThrow("synthetic late failure");
    expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.requestId, rows.operation.requestId))).toHaveLength(0);
    expect(await db.select().from(schema.startCheckinRevisions).where(eq(schema.startCheckinRevisions.id, rows.revision.id))).toHaveLength(0);
  });

  it("binds device to exact race/credential/capability and operations to race/entry/device owner", async () => {
    const f = await setup(), other = await setup("FINISH_FOREST_WATCH");
    for (const overrides of [{ raceId: other.raceId }, { actorCredentialId: other.actorCredentialId }, { capability: "FINISH_FOREST_WATCH" as const }]) {
      await expect(db.insert(schema.startCheckinDevices).values({ id: randomUUID(), raceId: f.raceId,
        actorCredentialId: f.actorCredentialId, capability: f.capability, label: "Test", registeredAt: at, ...overrides })).rejects.toThrow();
    }
    for (const overrides of [{ entryId: other.entryId }, { actorCredentialId: other.actorCredentialId }, { deviceId: other.deviceId }, { raceId: other.raceId }]) {
      await expect(db.insert(schema.startCheckinOperations).values(journal(f, overrides))).rejects.toThrow();
    }
  });

  it.each(["RETURN_ALREADY_REGISTERED", "DEPENDENCY_CONFLICT"] as const)("keeps durable %s distinct from an applied revision", async (reason) => {
    const f = await setup();
    const row = journal(f, { effect: "CONFLICT", conflictReason: reason });
    row.receipt = { ...row.receipt, effect: { kind: "CONFLICT", revision: 0, reason } };
    await db.insert(schema.startCheckinOperations).values(row);
    expect(await db.select().from(schema.startCheckinRevisions).where(eq(schema.startCheckinRevisions.raceId, f.raceId))).toHaveLength(0);
    await expect(db.insert(schema.startCheckinRevisions).values({ id: randomUUID(), requestId: row.requestId,
      raceId: f.raceId, entryId: f.entryId, revision: 1, startState: "REPORTED_NOT_STARTED", manualReturnRegistered: false })).rejects.toThrow();
  });

  it("enforces unique request, concurrent device sequence and entry revision", async () => {
    const f = await setup();
    const row = journal(f);
    const outcomes = await Promise.allSettled([
      db.insert(schema.startCheckinOperations).values(row),
      db.insert(schema.startCheckinOperations).values({ ...row, requestId: randomUUID() })
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [stored] = await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.deviceId, f.deviceId));
    if (!stored) throw new Error("Missing journal");
    await expect(db.insert(schema.startCheckinOperations).values({ ...stored, localSequence: 2 })).rejects.toThrow();
    const other = await setup(), first = applied(other), second = applied(other);
    await db.transaction(async (tx) => { await tx.insert(schema.startCheckinOperations).values(first.operation); await tx.insert(schema.startCheckinRevisions).values(first.revision); });
    await expect(db.transaction(async (tx) => {
      await tx.insert(schema.startCheckinOperations).values({ ...second.operation, localSequence: 2 });
      await tx.insert(schema.startCheckinRevisions).values(second.revision);
    })).rejects.toThrow();
  });

  it("rejects update/delete of devices, operations and revisions", async () => {
    const f = await setup(), rows = applied(f);
    await db.transaction(async (tx) => { await tx.insert(schema.startCheckinOperations).values(rows.operation); await tx.insert(schema.startCheckinRevisions).values(rows.revision); });
    await expect(db.update(schema.startCheckinDevices).set({ label: "changed" }).where(eq(schema.startCheckinDevices.id, f.deviceId))).rejects.toThrow();
    await expect(db.delete(schema.startCheckinDevices).where(eq(schema.startCheckinDevices.id, f.deviceId))).rejects.toThrow();
    await expect(db.update(schema.startCheckinOperations).set({ contentHash: "b".repeat(64) }).where(eq(schema.startCheckinOperations.requestId, rows.operation.requestId))).rejects.toThrow();
    await expect(db.delete(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.requestId, rows.operation.requestId))).rejects.toThrow();
    await expect(db.update(schema.startCheckinRevisions).set({ startState: "UNMARKED" }).where(eq(schema.startCheckinRevisions.id, rows.revision.id))).rejects.toThrow();
    await expect(db.delete(schema.startCheckinRevisions).where(eq(schema.startCheckinRevisions.id, rows.revision.id))).rejects.toThrow();
  });

  it("rejects invalid counters, hash, JSON and effect shape", async () => {
    const f = await setup();
    const invalid: Partial<typeof schema.startCheckinOperations.$inferInsert>[] = [
      { localSequence: 0 }, { packageVersion: 0 }, { expectedEntryVersion: 0 }, { expectedRevision: -1 },
      { contentHash: "A".repeat(64) }, { effect: "APPLIED", resultingRevision: 1 },
      { effect: "UNCHANGED", resultingRevision: 1 }, { effect: "CONFLICT", conflictReason: null },
      { effect: "CONFLICT", conflictReason: "STALE_ENTRY", createdRevisionId: randomUUID() },
      { effect: "APPLIED", createdRevisionId: randomUUID(), resultingRevision: 2 }
    ];
    for (const change of invalid) await expect(db.insert(schema.startCheckinOperations).values(journal(f, change))).rejects.toThrow();
    await expect(db.insert(schema.startCheckinOperations).values({ ...journal(f), intent: sql`'[]'::jsonb` })).rejects.toThrow();
    await expect(db.insert(schema.startCheckinOperations).values({ ...journal(f), receipt: sql`'null'::jsonb` })).rejects.toThrow();
  });

  it("does not admit read-only credentials or extend start/finish credential lifetime", async () => {
    const f = await setup();
    const credential = { id: randomUUID(), raceId: f.raceId, capability: "VIEW_START_LIST" as const,
      label: "Read only", secretHash: "b".repeat(64), issuedAt: at, expiresAt: new Date("2026-09-05T16:00:00.000Z") };
    await db.insert(schema.pairingAdminAccessCredentials).values(credential);
    await expect(db.insert(schema.startCheckinDevices).values({ id: randomUUID(), raceId: f.raceId,
      actorCredentialId: credential.id, capability: "VIEW_START_LIST", label: "No write authority", registeredAt: at })).rejects.toThrow();
    for (const capability of ["START_CHECKIN", "FINISH_FOREST_WATCH"] as const) {
      await expect(db.insert(schema.pairingAdminAccessCredentials).values({ ...credential, id: randomUUID(), capability,
        expiresAt: new Date("2026-09-05T16:00:00.001Z") })).rejects.toThrow();
    }
  });
});
