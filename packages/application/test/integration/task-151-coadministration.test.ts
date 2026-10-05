import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "@o-tid/database";
import { createDatabase, schema } from "@o-tid/database";
import {
  grantEventAdministratorAsUserAccount,
  listEventAdministratorsAsUserAccount,
  revokeEventAdministratorAsUserAccount
} from "../../src/organizer-coadministration";
import { createEventAsUserAccount, enterRaceAsUserAccount, listMyEventsAsUserAccount } from "../../src/organizer-events";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForProtectedRead,
  issuePairingAdminAccessCredential,
  loginPairingAdmin
} from "../../src/pairing-admin";
import { registerTestAccount } from "./accounts";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("TASK151 kräver uttrycklig TEST_DATABASE_URL till en isolerad PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_task151_spec_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const now = new Date("2026-09-23T10:00:00.000Z");

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_task151_spec_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function account(name: string) {
  const installation = await registerTestAccount(db, name, now);
  const login = installation.login;
  if (login.status !== "authenticated") throw new Error("Syntetiskt testkonto kunde inte logga in");
  return { installation, proof: {
    sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken
  } };
}

function createEvent(proof: Awaited<ReturnType<typeof account>>["proof"], name: string) {
  return createEventAsUserAccount(db, {
    ...proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: name, raceName: "Lång",
      raceDate: "2026-09-24", timeZone: "Europe/Stockholm" })
  }, now);
}

function grant(proof: Awaited<ReturnType<typeof account>>["proof"], eventId: string, email: string, requestId = randomUUID()) {
  const body = { formatVersion: 1, requestId, eventId, email, role: "ADMIN" as const };
  return { requestId, input: { ...proof, idempotencyKey: `organizer-admin-grant:${requestId}`,
    readBody: async () => body } };
}

function revoke(proof: Awaited<ReturnType<typeof account>>["proof"], eventId: string, grantId: string,
  requestId = randomUUID(), reason = "Avslutat test") {
  const body = { formatVersion: 1, requestId, eventId, grantId, reason };
  return { requestId, input: { ...proof, grantId, idempotencyKey: `organizer-admin-revoke:${requestId}`,
    readBody: async () => body } };
}

describe("TASK151 ägarstyrd eventbunden medadministration", () => {
  it("serialiserar grant, begränsar ADMIN till eventet, återkallar omedelbart och bevarar återtilldelningshistorik", async () => {
    const owner = await account(`owner.${randomUUID().slice(0, 8)}`);
    const administrator = await account(`admin.${randomUUID().slice(0, 8)}`);
    const concurrentAdministrator = await account(`admin.${randomUUID().slice(0, 8)}`);
    const [eventA, eventB] = await Promise.all([
      createEvent(owner.proof, "Syntetiskt event A"), createEvent(owner.proof, "Syntetiskt event B")
    ]);
    if (eventA.status !== "created" || eventB.status !== "created") throw new Error("Syntetiskt event kunde inte skapas");

    const firstIntent = grant(owner.proof, eventA.response.eventId, administrator.installation.email);
    const first = await grantEventAdministratorAsUserAccount(db, firstIntent.input, now);
    expect(first.status).toBe("granted");
    if (first.status !== "granted") throw new Error("ADMIN-tilldelning misslyckades");
    const replay = await grantEventAdministratorAsUserAccount(db, firstIntent.input, new Date(now.getTime() + 1));
    expect(replay).toMatchObject({ status: "granted", response: { grantId: first.response.grantId, replayed: true } });
    expect((await grantEventAdministratorAsUserAccount(db,
      grant(owner.proof, eventA.response.eventId, `other.${randomUUID().slice(0, 8)}@test.o-tid.se`, firstIntent.requestId).input, now))
      .status).toBe("conflict");
    expect((await grantEventAdministratorAsUserAccount(db,
      grant(administrator.proof, eventA.response.eventId, administrator.installation.email, firstIntent.requestId).input,
      now)).status).toBe("conflict");
    expect((await grantEventAdministratorAsUserAccount(db,
      grant(owner.proof, eventB.response.eventId, administrator.installation.email, firstIntent.requestId).input,
      now)).status).toBe("conflict");

    const simultaneous = await Promise.all([
      grantEventAdministratorAsUserAccount(db, grant(owner.proof, eventB.response.eventId,
        concurrentAdministrator.installation.email).input, new Date(now.getTime() + 2)),
      grantEventAdministratorAsUserAccount(db, grant(owner.proof, eventB.response.eventId,
        concurrentAdministrator.installation.email).input, new Date(now.getTime() + 2))
    ]);
    expect(simultaneous.map(result => result.status).sort()).toEqual(["conflict", "granted"]);
    const adminGrants = await db.select().from(schema.eventAdministrationGrants).where(eq(
      schema.eventAdministrationGrants.eventId, eventA.response.eventId));
    expect(adminGrants.filter(item => item.role === "ADMIN" && item.accountId === administrator.installation.accountId))
      .toHaveLength(1);
    const concurrentGrants = await db.select().from(schema.eventAdministrationGrants).where(eq(
      schema.eventAdministrationGrants.eventId, eventB.response.eventId));
    expect(concurrentGrants.filter(item => item.role === "ADMIN" &&
      item.accountId === concurrentAdministrator.installation.accountId)).toHaveLength(1);

    const mine = await listMyEventsAsUserAccount(db, administrator.proof, now);
    expect(mine).toMatchObject({ status: "ok", response: { events: [{ eventId: eventA.response.eventId, role: "ADMIN" }] } });
    if (mine.status !== "ok") throw new Error("ADMIN:s eventlista saknas");
    expect(mine.response.events.map(event => event.eventId)).toEqual([eventA.response.eventId]);
    const entered = await enterRaceAsUserAccount(db, { ...administrator.proof, raceId: eventA.response.raceId }, now);
    expect(entered.status).toBe("entered");
    expect((await enterRaceAsUserAccount(db, { ...administrator.proof, raceId: eventB.response.raceId }, now)).status)
      .toBe("not-found");
    if (entered.status !== "entered") throw new Error("ADMIN kunde inte öppna tilldelat lopp");
    const delegated = { raceId: eventA.response.raceId, capability: "MANAGE_RACE" as const,
      sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken,
      csrfHeader: entered.csrfToken, requireCsrf: true };
    expect((await authenticatePairingAdminSession(db, delegated, now)).status).toBe("authenticated");
    const classRequest = { formatVersion: 1 as const, requestId: randomUUID(), expectedSnapshotVersion: 1,
      courseName: "Syntetisk bana", className: "H21", startRule: "PUNCH" as const, controlCodes: [31] };
    expect((await createManualCourseClassAsAdministrator(db, { ...delegated,
      idempotencyKey: `manual-course-class-create:${classRequest.requestId}`, request: classRequest }, now)).status)
      .toBe("created");
    const legacy = await issuePairingAdminAccessCredential(db, {
      raceId: eventA.response.raceId, capability: "MANAGE_RACE", label: "Syntetisk äldre rätt",
      expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000)
    }, { now });
    const legacyLogin = await loginPairingAdmin(db, { formatVersion: 1,
      accessCredential: legacy.accessCredential }, {
      expectedRaceId: eventA.response.raceId, expectedCapability: "MANAGE_RACE", now
    });
    if (legacyLogin.status !== "authenticated") throw new Error("Äldre testbehörighet kunde inte öppnas");

    expect((await listEventAdministratorsAsUserAccount(db, { ...administrator.proof,
      eventId: eventA.response.eventId }, now)).status).toBe("not-found");
    expect((await grantEventAdministratorAsUserAccount(db,
      grant(administrator.proof, eventA.response.eventId, owner.installation.email).input, now)).status)
      .toBe("not-found");

    const revokeIntent = revoke(owner.proof, eventA.response.eventId, first.response.grantId);
    expect((await revokeEventAdministratorAsUserAccount(db, revokeIntent.input, new Date(now.getTime() + 3000))).status)
      .toBe("revoked");
    expect((await authenticatePairingAdminSession(db, delegated, new Date(now.getTime() + 4000))).status)
      .toBe("unauthorized");
    expect((await authenticatePairingAdminSession(db, { raceId: eventA.response.raceId,
      capability: "MANAGE_RACE", sessionToken: legacyLogin.sessionToken },
    new Date(now.getTime() + 4000))).status).toBe("authenticated");
    expect((await db.transaction(tx => authenticatePairingAdminSessionForProtectedRead(tx, delegated,
      new Date(now.getTime() + 4000)))).status).toBe("unauthorized");
    const rejectedMutation = { ...classRequest, requestId: randomUUID(), expectedSnapshotVersion: 2 };
    expect((await createManualCourseClassAsAdministrator(db, { ...delegated,
      idempotencyKey: `manual-course-class-create:${rejectedMutation.requestId}`, request: rejectedMutation },
    new Date(now.getTime() + 4000))).status).toBe("unauthorized");

    const ownerHistory = await listEventAdministratorsAsUserAccount(db,
      { ...owner.proof, eventId: eventA.response.eventId }, new Date(now.getTime() + 5000));
    expect(ownerHistory).toMatchObject({ status: "ok", response: { grants: [{
      grantId: first.response.grantId, accountId: administrator.installation.accountId, role: "ADMIN",
      revokedAt: new Date(now.getTime() + 3000).toISOString()
    }] } });
    expect((await revokeEventAdministratorAsUserAccount(db, revokeIntent.input,
      new Date(now.getTime() + 6000))).status).toBe("revoked");
    const [revokeAudit] = await db.select({ actorId: schema.auditEvents.actorId,
      action: schema.auditEvents.action }).from(schema.auditEvents)
      .where(eq(schema.auditEvents.requestId, revokeIntent.requestId));
    expect(revokeAudit).toEqual({ actorId: owner.installation.accountId,
      action: "EVENT_ADMIN_REVOKED_BY_OWNER" });

    const regrant = await grantEventAdministratorAsUserAccount(db,
      grant(owner.proof, eventA.response.eventId, administrator.installation.email).input,
      new Date(now.getTime() + 7000));
    expect(regrant.status).toBe("granted");
    if (regrant.status !== "granted") throw new Error("Återtilldelning misslyckades");
    expect(regrant.response.grantId).not.toBe(first.response.grantId);
    expect((await db.transaction(tx => authenticatePairingAdminSessionForProtectedRead(tx, delegated,
      new Date(now.getTime() + 8000)))).status).toBe("unauthorized");
    const finalHistory = await listEventAdministratorsAsUserAccount(db,
      { ...owner.proof, eventId: eventA.response.eventId }, new Date(now.getTime() + 8000));
    expect(finalHistory.status).toBe("ok");
    if (finalHistory.status !== "ok") throw new Error("Ägarhistoriken saknas efter återtilldelning");
    expect(finalHistory.response.grants).toHaveLength(2);
    expect(finalHistory.response.grants[0]).toMatchObject({ grantId: first.response.grantId,
      revokedAt: new Date(now.getTime() + 3000).toISOString() });
    expect(finalHistory.response.grants[1]).toMatchObject({ grantId: regrant.response.grantId, revokedAt: null });
  });
});
