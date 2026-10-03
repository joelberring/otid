import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { and, eq } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import { issueCheckinRecoveryGrant, revokeCheckinRecoveryGrant } from "../../src/checkin-recovery-grants";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-05T10:00:00.000Z");
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function setup(options: { active?: boolean; capability?: "START_CHECKIN" | "FINISH_FOREST_WATCH" } = {}) {
  const eventId = randomUUID(), raceId = randomUUID(), credentialId = randomUUID(), deviceId = randomUUID();
  const capability = options.capability ?? "START_CHECKIN";
  await db.insert(schema.events).values({ id: eventId, name: "Synthetic recovery", startsOn: "2026-09-05", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Recovery", raceDate: "2026-09-05" });
  await db.insert(schema.pairingAdminAccessCredentials).values({ id: credentialId, raceId, capability, label: "Original operator",
    secretHash: hash("credential"), issuedAt: new Date("2026-09-05T08:00:00.000Z"),
    expiresAt: options.active ? new Date("2026-09-05T12:00:00.000Z") : new Date("2026-09-05T09:00:00.000Z") });
  await db.insert(schema.startCheckinDevices).values({ id: deviceId, raceId, actorCredentialId: credentialId, capability, label: "Mobil", registeredAt: now });
  return { raceId, credentialId, deviceId, capability };
}

function manifest(f: Awaited<ReturnType<typeof setup>>, count = 1, overrides: Record<string, unknown> = {}) {
  return { formatVersion: 1, kind: "OTID_CHECKIN_RECOVERY_MANIFEST", raceId: f.raceId, deviceId: f.deviceId,
    actorCredentialId: f.credentialId, capability: f.capability, firstSequence: 1, lastSequence: count,
    items: Array.from({ length: count }, (_, index) => ({ requestId: randomUUID(), localSequence: index + 1, contentHash: hash(`operation-${index + 1}`) })), ...overrides };
}

async function operation(f: Awaited<ReturnType<typeof setup>>, item: { requestId: string; localSequence: number; contentHash: string }, overrides: Record<string, unknown> = {}) {
  const courseId = randomUUID(), versionId = randomUUID(), classId = randomUUID(), entryId = randomUUID();
  await db.insert(schema.courses).values({ id: courseId, raceId: f.raceId, name: `Course ${item.localSequence}` });
  await db.insert(schema.courseVersions).values({ id: versionId, courseId, version: 1 });
  await db.insert(schema.classes).values({ id: classId, raceId: f.raceId, name: `Class ${item.localSequence}`, courseVersionId: versionId, startRule: "PUNCH" });
  await db.insert(schema.entries).values({ id: entryId, raceId: f.raceId, classId, givenName: "Test", familyName: "Runner" });
  await db.insert(schema.startCheckinOperations).values({ requestId: item.requestId, deviceId: f.deviceId, actorCredentialId: f.credentialId,
    raceId: f.raceId, entryId, localSequence: item.localSequence, packageVersion: 1, expectedEntryVersion: 1, expectedRevision: 0,
    contentHash: item.contentHash, intent: {}, observedAt: now, receivedAt: now, effect: "UNCHANGED", resultingRevision: 0,
    createdRevisionId: null, conflictReason: null, receipt: {}, ...overrides });
}

describe("TASK 006W trusted check-in recovery grant issuer", () => {
  it("issues an expired original credential's exact frozen manifest without storing plaintext secret", async () => {
    const f = await setup(), input = manifest(f, 2), bytes = new Uint8Array(32).fill(7);
    const issued = await issueCheckinRecoveryGrant(db, { manifest: input, operatorLabel: "Ansvarig", reason: "Kö återställs",
      expiresAt: new Date("2026-09-05T10:30:00.000Z") }, { now, secretBytes: bytes });
    expect(issued.token).toBe(`otid_checkin_recovery_v1.${issued.grantId}.${Buffer.from(bytes).toString("base64url")}`);
    const [grant] = await db.select().from(schema.checkinRecoveryGrants).where(eq(schema.checkinRecoveryGrants.id, issued.grantId));
    expect(grant).toMatchObject({ manifestHash: issued.manifestHash, secretHash: hash(Buffer.from(bytes)), firstSequence: 1, lastSequence: 2 });
    expect(JSON.stringify(grant)).not.toContain(issued.token.split(".")[2] ?? "never");
    expect(await db.select().from(schema.checkinRecoveryGrantItems).where(eq(schema.checkinRecoveryGrantItems.grantId, issued.grantId))).toHaveLength(2);
    expect(await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.entityId, issued.grantId), eq(schema.auditEvents.action, "CHECKIN_RECOVERY_GRANT_ISSUED")))).toHaveLength(1);
  });

  it("rejects active credentials, invalid bounds, strict invalid manifests and scope changes", async () => {
    const active = await setup({ active: true });
    await expect(issueCheckinRecoveryGrant(db, { manifest: manifest(active), operatorLabel: "A", reason: "R", expiresAt: new Date("2026-09-05T10:01:00.000Z") }, { now })).rejects.toThrow("Ogiltig");
    const f = await setup();
    for (const candidate of [
      { ...manifest(f), items: [] }, { ...manifest(f), extra: true },
      { ...manifest(f), capability: "FINISH_FOREST_WATCH" }, { ...manifest(f), firstSequence: 2, lastSequence: 2 }
    ]) await expect(issueCheckinRecoveryGrant(db, { manifest: candidate, operatorLabel: "A", reason: "R", expiresAt: new Date("2026-09-05T10:01:00.000Z") }, { now })).rejects.toThrow("Ogiltig");
    for (const expiry of [now, new Date("2026-09-05T11:00:00.001Z")]) {
      await expect(issueCheckinRecoveryGrant(db, { manifest: manifest(f), operatorLabel: "A", reason: "R", expiresAt: expiry }, { now })).rejects.toThrow("Ogiltig");
    }
  });

  it("also permits a revoked original credential while preserving its permanent scope", async () => {
    const f = await setup({ active: true });
    await db.insert(schema.pairingAdminAccessCredentialRevocations).values({ credentialId: f.credentialId, revokedAt: now, reason: "EXPLICIT" });
    const issued = await issueCheckinRecoveryGrant(db, { manifest: manifest(f), operatorLabel: "A", reason: "R",
      expiresAt: new Date("2026-09-05T10:01:00.000Z") }, { now });
    expect(issued.grantId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("requires exact committed overlap and the first missing server sequence", async () => {
    const f = await setup(), exact = manifest(f, 2);
    await operation(f, exact.items[0]!);
    const overlapping = await issueCheckinRecoveryGrant(db, { manifest: exact, operatorLabel: "A", reason: "R",
      expiresAt: new Date("2026-09-05T10:01:00.000Z") }, { now });
    expect(overlapping.grantId).toMatch(/^[0-9a-f-]{36}$/);
    const changed = manifest(f);
    await operation(f, { ...changed.items[0]!, localSequence: 3 });
    await expect(issueCheckinRecoveryGrant(db, { manifest: changed, operatorLabel: "A", reason: "R", expiresAt: new Date("2026-09-05T10:01:00.000Z") }, { now })).rejects.toThrow("Ogiltig");
    const foreign = await setup();
    const collision = manifest(f);
    await operation(foreign, { ...collision.items[0]!, localSequence: 1 });
    await expect(issueCheckinRecoveryGrant(db, { manifest: collision, operatorLabel: "A", reason: "R", expiresAt: new Date("2026-09-05T10:01:00.000Z") }, { now })).rejects.toThrow("Ogiltig");
  });

  it("rejects an exact-ID changed hash, a valid-shaped sequence gap and a foreign request without any grant", async () => {
    const f = await setup(), saved = manifest(f);
    await operation(f, saved.items[0]!);
    const changedHash = { ...saved, items: [{ ...saved.items[0]!, contentHash: "f".repeat(64) }] };
    const empty = await setup(), gap = manifest(empty);
    const validGap = { ...gap, firstSequence: 2, lastSequence: 2, items: [{ ...gap.items[0]!, localSequence: 2 }] };
    const foreignRequest = { ...manifest(empty), items: saved.items };
    for (const candidate of [changedHash, validGap, foreignRequest]) {
      await expect(issueCheckinRecoveryGrant(db, { manifest: candidate, operatorLabel: "A", reason: "R",
        expiresAt: new Date("2026-09-05T10:01:00.000Z") }, { now })).rejects.toThrow("Ogiltig");
    }
    for (const raceId of [f.raceId, empty.raceId]) {
      expect(await db.select().from(schema.checkinRecoveryGrants).where(eq(schema.checkinRecoveryGrants.raceId, raceId))).toHaveLength(0);
    }
  });

  it("persists all 20,000 manifest items using bounded SQL batches", async () => {
    const f = await setup({ capability: "FINISH_FOREST_WATCH" }), full = manifest(f, 20_000);
    const issued = await issueCheckinRecoveryGrant(db, { manifest: full, operatorLabel: "A", reason: "R",
      expiresAt: new Date("2026-09-05T11:00:00.000Z") }, { now });
    const items = await db.select({ requestId: schema.checkinRecoveryGrantItems.requestId })
      .from(schema.checkinRecoveryGrantItems).where(eq(schema.checkinRecoveryGrantItems.grantId, issued.grantId));
    expect(new Set(items.map((item) => item.requestId))).toEqual(new Set(full.items.map((item) => item.requestId)));
  }, 30_000);

  it("revokes atomically, repeats the same intent safely and conflicts on changed intent", async () => {
    const f = await setup(), issued = await issueCheckinRecoveryGrant(db, { manifest: manifest(f), operatorLabel: "A", reason: "R", expiresAt: new Date("2026-09-05T10:01:00.000Z") }, { now });
    expect(await revokeCheckinRecoveryGrant(db, { grantId: issued.grantId, operatorLabel: "A", reason: "R" }, now)).toMatchObject({ status: "revoked" });
    expect(await revokeCheckinRecoveryGrant(db, { grantId: issued.grantId, operatorLabel: "A", reason: "R" }, new Date("2026-09-05T10:02:00.000Z"))).toMatchObject({ status: "already-revoked" });
    await expect(revokeCheckinRecoveryGrant(db, { grantId: issued.grantId, operatorLabel: "B", reason: "R" }, now)).rejects.toThrow("Ogiltig");
    expect(await db.select().from(schema.checkinRecoveryGrantRevocations).where(eq(schema.checkinRecoveryGrantRevocations.grantId, issued.grantId))).toHaveLength(1);
    expect(await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.entityId, issued.grantId), eq(schema.auditEvents.action, "CHECKIN_RECOVERY_GRANT_REVOKED")))).toHaveLength(1);
  });
});
