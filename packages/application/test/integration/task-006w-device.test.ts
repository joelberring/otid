import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "@o-tid/database";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import {
  issuePairingAdminAccessCredential, loginPairingAdmin, registerStartCheckinDeviceAsAdmin,
  revokePairingAdminAccessCredential, type RaceAdminCapability
} from "../../src";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const at = new Date("2026-09-05T08:00:00.000Z");
const clock = () => at;
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function race() {
  const eventId = randomUUID(), raceId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "Syntetisk enhetsregistrering", startsOn: "2026-09-05", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Test", raceDate: "2026-09-05" });
  return raceId;
}

async function session(credential: Awaited<ReturnType<typeof issuePairingAdminAccessCredential>>) {
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: credential.accessCredential }, {
    expectedRaceId: credential.raceId, expectedCapability: credential.capability, now: at
  });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  return { raceId: credential.raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
}

async function admin(raceId: string, capability: RaceAdminCapability = "START_CHECKIN") {
  const credential = await issuePairingAdminAccessCredential(db, {
    raceId, capability, label: "Synthetic operator", expiresAt: new Date("2026-09-05T16:00:00.000Z")
  }, { now: at });
  return { credential, auth: await session(credential) };
}

const intent = () => ({ formatVersion: 1, deviceId: randomUUID(), label: "Startmobil" });
async function registrations(deviceId: string) {
  return db.select().from(schema.startCheckinDevices).where(eq(schema.startCheckinDevices.id, deviceId));
}
async function audits(deviceId: string) {
  return db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.entityId, deviceId), eq(schema.auditEvents.action, "START_CHECKIN_DEVICE_REGISTERED")));
}

describe("TASK 006W authenticated device registration", () => {
  it.each(["START_CHECKIN", "FINISH_FOREST_WATCH"] as const)("registers %s with atomic audit, exact retry and fresh-session recovery", async (capability) => {
    const raceId = await race(), a = await admin(raceId, capability), request = intent();
    const input = { ...a.auth, capability, readBody: async () => request };
    const first = await registerStartCheckinDeviceAsAdmin(db, input, clock);
    expect(first).toEqual({ status: "registered", response: { formatVersion: 1, deviceId: request.deviceId,
      raceId, actorCredentialId: a.credential.credentialId, capability, label: request.label, registeredAt: at.toISOString() } });
    expect(await registerStartCheckinDeviceAsAdmin(db, input, clock)).toEqual(first);
    expect(await registerStartCheckinDeviceAsAdmin(db, { ...input, ...await session(a.credential) },
      () => new Date("2026-09-05T08:10:00.000Z"))).toEqual(first);
    expect(await registrations(request.deviceId)).toHaveLength(1);
    const recorded = await audits(request.deviceId);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.actorId).toBe(a.credential.credentialId);
    expect(recorded[0]?.actorKind).toBe(capability === "START_CHECKIN" ? "START_CHECKIN_ACCESS_CREDENTIAL" : "FINISH_FOREST_WATCH_ACCESS_CREDENTIAL");
    for (const table of [schema.startCheckinOperations, schema.startCheckinRevisions, schema.resultRevisions, schema.rawDeviceMessages]) {
      expect(await db.select().from(table).where(eq(table.raceId, raceId))).toHaveLength(0);
    }
    const [unchanged] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    expect(unchanged?.snapshotVersion).toBe(1);
  });

  it("rejects changed label, owner or race without replacing device identity", async () => {
    const raceId = await race(), a = await admin(raceId), other = await admin(raceId), cross = await admin(await race()), request = intent();
    const input = { ...a.auth, capability: "START_CHECKIN" as const, readBody: async () => request };
    const original = await registerStartCheckinDeviceAsAdmin(db, input, clock);
    expect(original.status).toBe("registered");
    for (const change of [
      { readBody: async () => ({ ...request, label: "Changed label" }) },
      { ...other.auth }, { ...cross.auth }
    ]) expect(await registerStartCheckinDeviceAsAdmin(db, { ...input, ...change }, clock)).toEqual({ status: "conflict" });
    expect(await registerStartCheckinDeviceAsAdmin(db, input, clock)).toEqual(original);
    expect(await audits(request.deviceId)).toHaveLength(1);
  });

  it("authenticates before body and separates start, finish, read-only and race scopes", async () => {
    const raceId = await race(), start = await admin(raceId), readOnly = await admin(raceId, "VIEW_START_LIST"), request = intent();
    const readBody = vi.fn(async () => request);
    const base = { ...start.auth, capability: "START_CHECKIN" as const, readBody };
    expect(await registerStartCheckinDeviceAsAdmin(db, { ...base, sessionToken: null }, clock)).toEqual({ status: "unauthorized" });
    expect(await registerStartCheckinDeviceAsAdmin(db, { ...base, csrfHeader: null }, clock)).toEqual({ status: "forbidden" });
    expect(await registerStartCheckinDeviceAsAdmin(db, { ...base, capability: "FINISH_FOREST_WATCH" }, clock)).toEqual({ status: "forbidden" });
    expect(await registerStartCheckinDeviceAsAdmin(db, { ...base, ...readOnly.auth }, clock)).toEqual({ status: "forbidden" });
    expect(await registerStartCheckinDeviceAsAdmin(db, { ...base, raceId: await race() }, clock)).toEqual({ status: "forbidden" });
    expect(readBody).not.toHaveBeenCalled();
    expect(await registrations(request.deviceId)).toHaveLength(0);
    expect(await audits(request.deviceId)).toHaveLength(0);
    expect(await registerStartCheckinDeviceAsAdmin(db, { ...base, readBody: async () => ({ ...request, extra: true }) }, clock)).toEqual({ status: "invalid-request" });
  });

  it("revalidates revocation and session expiry after body reading, without device writes", async () => {
    const raceId = await race(), a = await admin(raceId), expired = await admin(raceId);
    const first = intent(), second = intent();
    expect(await registerStartCheckinDeviceAsAdmin(db, { ...a.auth, capability: "START_CHECKIN", readBody: async () => {
      await revokePairingAdminAccessCredential(db, { credentialId: a.credential.credentialId, capability: "START_CHECKIN" }, at);
      return first;
    } }, clock)).toEqual({ status: "unauthorized" });
    let current = at;
    expect(await registerStartCheckinDeviceAsAdmin(db, { ...expired.auth, capability: "START_CHECKIN", readBody: async () => {
      current = new Date("2026-09-05T09:00:00.000Z");
      return second;
    } }, () => current)).toEqual({ status: "unauthorized" });
    for (const request of [first, second]) {
      expect(await registrations(request.deviceId)).toHaveLength(0);
      expect(await audits(request.deviceId)).toHaveLength(0);
    }
  });

  it("serializes simultaneous retries and conflicting owners", async () => {
    const raceId = await race(), a = await admin(raceId), b = await admin(raceId);
    const request = intent(), same = { ...a.auth, capability: "START_CHECKIN" as const, readBody: async () => request };
    const results = await Promise.all([
      registerStartCheckinDeviceAsAdmin(db, same, clock),
      registerStartCheckinDeviceAsAdmin(db, { ...same, ...await session(a.credential) }, clock)
    ]);
    expect(results[0]?.status).toBe("registered");
    expect(results[0]).toEqual(results[1]);
    expect(await registrations(request.deviceId)).toHaveLength(1);
    expect(await audits(request.deviceId)).toHaveLength(1);
    const contested = intent();
    const competition = await Promise.all([a, b].map((owner) => registerStartCheckinDeviceAsAdmin(db, {
      ...owner.auth, capability: "START_CHECKIN", readBody: async () => contested
    }, clock)));
    expect(competition.filter((r) => r.status === "registered")).toHaveLength(1);
    expect(competition.filter((r) => r.status === "conflict")).toHaveLength(1);
    expect(await registrations(contested.deviceId)).toHaveLength(1);
    expect(await audits(contested.deviceId)).toHaveLength(1);
  });

  it("rolls back registration on audit failure and can retry the same device id", async () => {
    const a = await admin(await race()), request = intent();
    const input = { ...a.auth, capability: "START_CHECKIN" as const, readBody: async () => request };
    await db.execute(sql`CREATE FUNCTION otid_test_006w_fail_registration_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'START_CHECKIN_DEVICE_REGISTERED' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await db.execute(sql`CREATE TRIGGER otid_test_006w_fail_registration_audit BEFORE INSERT ON audit_event
      FOR EACH ROW EXECUTE FUNCTION otid_test_006w_fail_registration_audit()`);
    try {
      await expect(registerStartCheckinDeviceAsAdmin(db, input, clock)).rejects.toThrow();
      expect(await registrations(request.deviceId)).toHaveLength(0);
      expect(await audits(request.deviceId)).toHaveLength(0);
    } finally {
      await db.execute(sql`DROP TRIGGER otid_test_006w_fail_registration_audit ON audit_event`);
      await db.execute(sql`DROP FUNCTION otid_test_006w_fail_registration_audit()`);
    }
    expect((await registerStartCheckinDeviceAsAdmin(db, input, clock)).status).toBe("registered");
    expect(await audits(request.deviceId)).toHaveLength(1);
  });
});
