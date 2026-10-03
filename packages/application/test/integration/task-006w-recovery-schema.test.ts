import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const at = new Date("2026-09-05T10:00:00.000Z");
const hash = "a".repeat(64);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function setup() {
  const f = { eventId: randomUUID(), raceId: randomUUID(), courseId: randomUUID(), courseVersionId: randomUUID(), classId: randomUUID(), entryId: randomUUID(), actorCredentialId: randomUUID(), deviceId: randomUUID(), requestId: randomUUID(), grantId: randomUUID() };
  await db.transaction(async (tx) => {
    await tx.insert(schema.events).values({ id: f.eventId, name: "Syntetisk recovery", startsOn: "2026-09-05", timeZone: "Europe/Stockholm" });
    await tx.insert(schema.races).values({ id: f.raceId, eventId: f.eventId, name: "Test", raceDate: "2026-09-05" });
    await tx.insert(schema.courses).values({ id: f.courseId, raceId: f.raceId, name: "Testbana" });
    await tx.insert(schema.courseVersions).values({ id: f.courseVersionId, courseId: f.courseId, version: 1 });
    await tx.insert(schema.classes).values({ id: f.classId, raceId: f.raceId, courseVersionId: f.courseVersionId, name: "Testklass" });
    await tx.insert(schema.entries).values({ id: f.entryId, raceId: f.raceId, classId: f.classId, givenName: "Test", familyName: "Löpare" });
    await tx.insert(schema.pairingAdminAccessCredentials).values({ id: f.actorCredentialId, raceId: f.raceId, capability: "START_CHECKIN", label: "Synthetic operator", secretHash: hash, issuedAt: at, expiresAt: new Date("2026-09-05T18:00:00.000Z") });
    await tx.insert(schema.startCheckinDevices).values({ id: f.deviceId, raceId: f.raceId, actorCredentialId: f.actorCredentialId, capability: "START_CHECKIN", label: "Testmobil", registeredAt: at });
    await tx.insert(schema.startCheckinOperations).values({ requestId: f.requestId, deviceId: f.deviceId, actorCredentialId: f.actorCredentialId, raceId: f.raceId, entryId: f.entryId, localSequence: 1, packageVersion: 1, expectedEntryVersion: 1, expectedRevision: 0, contentHash: hash, intent: {}, observedAt: at, receivedAt: at, effect: "UNCHANGED", resultingRevision: 0, receipt: {} });
  });
  return f;
}

function grant(f: Awaited<ReturnType<typeof setup>>, overrides: Partial<typeof schema.checkinRecoveryGrants.$inferInsert> = {}) {
  return { id: f.grantId, deviceId: f.deviceId, actorCredentialId: f.actorCredentialId, raceId: f.raceId, capability: "START_CHECKIN" as const, manifestCanonicalJson: "{}", manifestHash: hash, secretHash: "b".repeat(64), firstSequence: 1, lastSequence: 1, operatorLabel: "Ansvarig", reason: "Återställ bevarad kö", issuedAt: at, expiresAt: new Date("2026-09-05T11:00:00.000Z"), ...overrides };
}
function item(f: Awaited<ReturnType<typeof setup>>, overrides: Partial<typeof schema.checkinRecoveryGrantItems.$inferInsert> = {}) {
  return { grantId: f.grantId, requestId: f.requestId, deviceId: f.deviceId, actorCredentialId: f.actorCredentialId, raceId: f.raceId, localSequence: 1, contentHash: hash, ...overrides };
}

describe("TASK 006W PostgreSQL recovery schema", () => {
  it("binds grant, frozen item and delivery to the exact permanent scope and original hash", async () => {
    const f = await setup();
    await db.insert(schema.checkinRecoveryGrants).values(grant(f));
    await db.insert(schema.checkinRecoveryGrantItems).values(item(f));
    await db.insert(schema.checkinRecoveryDeliveries).values({ ...item(f), deliveredAt: at });
    expect(await db.select().from(schema.checkinRecoveryDeliveries).where(eq(schema.checkinRecoveryDeliveries.grantId, f.grantId))).toHaveLength(1);
    await expect(db.insert(schema.checkinRecoveryDeliveries).values({ ...item(f), grantId: randomUUID(), deliveredAt: at })).rejects.toThrow();
    await expect(db.insert(schema.checkinRecoveryDeliveries).values({ ...item(f), contentHash: "c".repeat(64), deliveredAt: at })).rejects.toThrow();
  });

  it("independently enforces delivery membership and the original operation hash", async () => {
    const f = await setup();
    const changedHash = "c".repeat(64);
    await db.insert(schema.checkinRecoveryGrants).values(grant(f));
    await db.insert(schema.checkinRecoveryGrantItems).values(item(f, { contentHash: changedHash }));
    // No delivery exists: a duplicate-key failure cannot mask either foreign key.
    await expect(db.insert(schema.checkinRecoveryDeliveries).values({ ...item(f), deliveredAt: at }))
      .rejects.toMatchObject({ cause: { code: "23503", constraint: "checkin_recovery_delivery_item_scope_hash_fk" } });
    await expect(db.insert(schema.checkinRecoveryDeliveries).values({ ...item(f, { contentHash: changedHash }), deliveredAt: at }))
      .rejects.toMatchObject({ cause: { code: "23503", constraint: "checkin_recovery_delivery_operation_scope_hash_fk" } });
    expect(await db.select().from(schema.checkinRecoveryDeliveries).where(eq(schema.checkinRecoveryDeliveries.grantId, f.grantId))).toHaveLength(0);
  });

  it("rejects duplicate grant sequence/request, wrong scopes and invalid bounded lifetime", async () => {
    const f = await setup();
    await db.insert(schema.checkinRecoveryGrants).values(grant(f));
    await db.insert(schema.checkinRecoveryGrantItems).values(item(f));
    await expect(db.insert(schema.checkinRecoveryGrantItems).values({ ...item(f), requestId: randomUUID() })).rejects.toThrow();
    await expect(db.insert(schema.checkinRecoveryGrantItems).values({ ...item(f), localSequence: 2 })).rejects.toThrow();
    await expect(db.insert(schema.checkinRecoveryGrants).values(grant(f, { id: randomUUID(), deviceId: randomUUID() }))).rejects.toThrow();
    await expect(db.insert(schema.checkinRecoveryGrants).values(grant(f, { id: randomUUID(), expiresAt: new Date("2026-09-05T11:00:00.001Z") }))).rejects.toThrow();
    await expect(db.insert(schema.checkinRecoveryGrants).values(grant(f, { id: randomUUID(), expiresAt: at }))).rejects.toThrow();
  });

  it("makes grants, items, revocations and deliveries immutable and rolls back all later work", async () => {
    const f = await setup();
    await db.transaction(async (tx) => {
      await tx.insert(schema.checkinRecoveryGrants).values(grant(f));
      await tx.insert(schema.checkinRecoveryGrantItems).values(item(f));
      await tx.insert(schema.checkinRecoveryGrantRevocations).values({ grantId: f.grantId, operatorLabel: "Ansvarig", reason: "Avbruten", revokedAt: at });
      await tx.insert(schema.checkinRecoveryDeliveries).values({ ...item(f), deliveredAt: at });
    });
    await expect(db.update(schema.checkinRecoveryGrants).set({ reason: "Ändrad" }).where(eq(schema.checkinRecoveryGrants.id, f.grantId))).rejects.toThrow();
    await expect(db.delete(schema.checkinRecoveryGrantItems).where(eq(schema.checkinRecoveryGrantItems.grantId, f.grantId))).rejects.toThrow();
    await expect(db.delete(schema.checkinRecoveryGrantRevocations).where(eq(schema.checkinRecoveryGrantRevocations.grantId, f.grantId))).rejects.toThrow();
    await expect(db.delete(schema.checkinRecoveryDeliveries).where(eq(schema.checkinRecoveryDeliveries.grantId, f.grantId))).rejects.toThrow();
    const rolledBack = await setup();
    await expect(db.transaction(async (tx) => {
      await tx.insert(schema.checkinRecoveryGrants).values(grant(rolledBack));
      await tx.insert(schema.checkinRecoveryGrantItems).values(item(rolledBack));
      throw new Error("synthetic late failure");
    })).rejects.toThrow("synthetic late failure");
    expect(await db.select().from(schema.checkinRecoveryGrants).where(eq(schema.checkinRecoveryGrants.id, rolledBack.grantId))).toHaveLength(0);
    expect(await db.select().from(schema.checkinRecoveryGrantItems).where(eq(schema.checkinRecoveryGrantItems.grantId, rolledBack.grantId))).toHaveLength(0);
  });
});
