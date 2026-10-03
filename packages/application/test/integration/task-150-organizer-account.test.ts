import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "@o-tid/database";
import { createDatabase, schema } from "@o-tid/database";
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForProtectedRead,
  issuePairingAdminAccessCredential,
  loginPairingAdmin
} from "../../src/pairing-admin";
import {
  loginUserAccount,
  logoutUserAccountSession,
  provisionUserAccount,
  rotateUserAccountPassword
} from "../../src/user-account";
import { createEventAsUserAccount, enterRaceAsUserAccount, listMyEventsAsUserAccount } from "../../src/organizer-events";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("TASK150 kräver uttrycklig TEST_DATABASE_URL till en isolerad PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_task150_spec_${randomUUID().replaceAll("-", "")}`;
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
  if (!/^otid_task150_spec_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function account(loginName: string) {
  const installation = await provisionUserAccount(db, { loginName, displayName: `Arrangör ${loginName}` }, { now });
  const login = await loginUserAccount(db, {
    formatVersion: 1, loginName, password: installation.initialPassword
  }, { now });
  if (login.status !== "authenticated") throw new Error("Kontots testinloggning misslyckades");
  return { installation, login, proof: {
    sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken
  } };
}

function createInput(proof: Awaited<ReturnType<typeof account>>["proof"], key: string, name: string) {
  return { ...proof, idempotencyKey: `organizer-event-create:${key}`, readBody: async () => ({
    formatVersion: 1, eventName: name, raceName: "Lång", raceDate: "2026-09-24", timeZone: "Europe/Stockholm"
  }) };
}

describe("TASK150 kontobunden tävlingsadministration", () => {
  it("skapar en ägd tävling med exakt retry och skiljer annan användare från ägaren", async () => {
    const owner = await account(`owner.${randomUUID().slice(0, 8)}`);
    const other = await account(`other.${randomUUID().slice(0, 8)}`);
    const key = randomUUID();
    const input = createInput(owner.proof, key, "Syntetisk skogstävling");
    const created = await createEventAsUserAccount(db, input, now);
    expect(created.status).toBe("created");
    if (created.status !== "created") throw new Error("Skapandet misslyckades");
    const replay = await createEventAsUserAccount(db, input, now);
    expect(replay).toMatchObject({ status: "created", response: {
      eventId: created.response.eventId, raceId: created.response.raceId, replayed: true
    } });
    expect(await createEventAsUserAccount(db,
      createInput(owner.proof, key, "Annat namn"), now)).toEqual({ status: "conflict" });
    expect(await createEventAsUserAccount(db,
      createInput(other.proof, key, "Syntetisk skogstävling"), now)).toEqual({ status: "conflict" });
    const simultaneous = createInput(owner.proof, randomUUID(), "Samtidigt skapat lopp");
    const competing = await Promise.all([
      createEventAsUserAccount(db, simultaneous, now),
      createEventAsUserAccount(db, simultaneous, now)
    ]);
    expect(competing.map(result => result.status)).toEqual(["created", "created"]);
    const first = competing[0], second = competing[1];
    if (first?.status !== "created" || second?.status !== "created") {
      throw new Error("Samtidigt retry misslyckades");
    }
    expect(first.response.eventId).toBe(second.response.eventId);
    expect([first.response.replayed, second.response.replayed].sort()).toEqual([false, true]);
    expect((await db.select().from(schema.events).where(eq(schema.events.id, created.response.eventId)))).toHaveLength(1);
    const ownerAgain = await loginUserAccount(db, { formatVersion: 1,
      loginName: owner.installation.loginName, password: owner.installation.initialPassword
    }, { now: new Date(now.getTime() + 1000) });
    if (ownerAgain.status !== "authenticated") throw new Error("Återinloggning misslyckades");
    const listed = await listMyEventsAsUserAccount(db, { sessionToken: ownerAgain.sessionToken },
      new Date(now.getTime() + 2000));
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") throw new Error("Ägarlistan saknas efter ny inloggning");
    expect(listed.response.events.map(event => event.eventId)).toContain(created.response.eventId);
    expect(listed.response.events.find(event => event.eventId === created.response.eventId)?.races
      .map(race => race.raceId)).toContain(created.response.raceId);
    expect(await listMyEventsAsUserAccount(db, other.proof, now)).toMatchObject({ status: "ok", response: { events: [] } });
    expect(await enterRaceAsUserAccount(db, { ...other.proof, raceId: created.response.raceId }, now))
      .toEqual({ status: "not-found" });
  });

  it("binder delegerad MANAGE_RACE till kontosession och lämnar legacycredential orörd", async () => {
    const owner = await account(`admin.${randomUUID().slice(0, 8)}`);
    const created = await createEventAsUserAccount(db, createInput(owner.proof, randomUUID(), "Delegationstest"), now);
    if (created.status !== "created") throw new Error("Skapandet misslyckades");
    const raceId = created.response.raceId;
    const entered = await enterRaceAsUserAccount(db, { ...owner.proof, raceId }, now);
    if (entered.status !== "entered") throw new Error("Delegeringen misslyckades");
    const delegatedProof = { sessionToken: entered.sessionToken, raceId, capability: "MANAGE_RACE" as const,
      csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken, requireCsrf: true };
    expect((await authenticatePairingAdminSession(db, delegatedProof, now)).status).toBe("authenticated");
    expect((await db.transaction(tx => authenticatePairingAdminSessionForProtectedRead(tx, delegatedProof, now))).status)
      .toBe("authenticated");
    const classRequest = { formatVersion: 1 as const, requestId: randomUUID(), expectedSnapshotVersion: 1,
      courseName: "Syntetisk bana", className: "H21", startRule: "PUNCH" as const, controlCodes: [31] };
    const classCreated = await createManualCourseClassAsAdministrator(db, {
      ...delegatedProof, idempotencyKey: `manual-course-class-create:${classRequest.requestId}`,
      request: classRequest
    }, now);
    expect(classCreated.status).toBe("created");
    const legacy = await issuePairingAdminAccessCredential(db, {
      raceId, capability: "MANAGE_RACE", label: "Syntetisk äldre behörighet",
      expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000)
    }, { now });
    const legacyLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: legacy.accessCredential },
      { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
    if (legacyLogin.status !== "authenticated") throw new Error("Legacyinloggningen misslyckades");
    expect((await logoutUserAccountSession(db, owner.proof, new Date(now.getTime() + 2000))).status)
      .toBe("logged-out");
    expect((await authenticatePairingAdminSession(db, delegatedProof, new Date(now.getTime() + 3000))).status)
      .toBe("unauthorized");
    expect((await db.transaction(tx => authenticatePairingAdminSessionForProtectedRead(tx, delegatedProof,
      new Date(now.getTime() + 3000)))).status).toBe("unauthorized");
    const rejectedRequest = { ...classRequest, requestId: randomUUID(), expectedSnapshotVersion: 2 };
    expect((await createManualCourseClassAsAdministrator(db, {
      ...delegatedProof, idempotencyKey: `manual-course-class-create:${rejectedRequest.requestId}`,
      request: rejectedRequest
    }, new Date(now.getTime() + 3000))).status).toBe("unauthorized");
    expect((await authenticatePairingAdminSession(db, {
      raceId, capability: "MANAGE_RACE", sessionToken: legacyLogin.sessionToken
    }, new Date(now.getTime() + 3000))).status).toBe("authenticated");
  });

  it("spärrar delegering vid grantspärr och lösenordsrotation", async () => {
    const owner = await account(`rotate.${randomUUID().slice(0, 8)}`);
    const created = await createEventAsUserAccount(db, createInput(owner.proof, randomUUID(), "Granttest"), now);
    if (created.status !== "created") throw new Error("Skapandet misslyckades");
    const entered = await enterRaceAsUserAccount(db, { ...owner.proof, raceId: created.response.raceId }, now);
    if (entered.status !== "entered") throw new Error("Delegeringen misslyckades");
    const delegatedProof = { raceId: created.response.raceId, capability: "MANAGE_RACE" as const,
      sessionToken: entered.sessionToken };
    const rotated = await rotateUserAccountPassword(db, owner.installation.accountId,
      { now: new Date(now.getTime() + 2000) });
    expect(rotated.version).toBe(2);
    expect((await authenticatePairingAdminSession(db, delegatedProof, new Date(now.getTime() + 3000))).status)
      .toBe("unauthorized");
    const relogin = await loginUserAccount(db, { formatVersion: 1, loginName: owner.installation.loginName,
      password: rotated.password }, { now: new Date(now.getTime() + 4000) });
    expect(relogin.status).toBe("authenticated");
    if (relogin.status !== "authenticated") return;
    const newProof = { sessionToken: relogin.sessionToken, csrfCookie: relogin.csrfToken, csrfHeader: relogin.csrfToken };
    const newEntry = await enterRaceAsUserAccount(db, { ...newProof, raceId: created.response.raceId },
      new Date(now.getTime() + 5000));
    if (newEntry.status !== "entered") throw new Error("Ny delegering misslyckades");
    const [grant] = await db.select({ id: schema.eventAdministrationGrants.id }).from(schema.eventAdministrationGrants)
      .where(eq(schema.eventAdministrationGrants.eventId, created.response.eventId));
    if (!grant) throw new Error("Ägargranten saknas");
    await db.insert(schema.eventAdministrationGrantRevocations).values({
      grantId: grant.id, revokedAt: new Date(now.getTime() + 6000), reason: "TEST_REVOKED"
    });
    expect((await authenticatePairingAdminSession(db, {
      raceId: created.response.raceId, capability: "MANAGE_RACE", sessionToken: newEntry.sessionToken
    }, new Date(now.getTime() + 7000))).status).toBe("unauthorized");
    expect(await listMyEventsAsUserAccount(db, newProof, new Date(now.getTime() + 7000)))
      .toMatchObject({ status: "ok", response: { events: [] } });
  });

  it("avvisar både kontoläsning och delegerad race-session efter kontospärr", async () => {
    const owner = await account(`blocked.${randomUUID().slice(0, 8)}`);
    const created = await createEventAsUserAccount(db, createInput(owner.proof, randomUUID(), "Kontospärrstest"), now);
    if (created.status !== "created") throw new Error("Skapandet misslyckades");
    const entered = await enterRaceAsUserAccount(db, { ...owner.proof, raceId: created.response.raceId }, now);
    if (entered.status !== "entered") throw new Error("Delegeringen misslyckades");
    await db.insert(schema.userAccountRevocations).values({
      accountId: owner.installation.accountId, revokedAt: new Date(now.getTime() + 1000), reason: "TEST_REVOKED"
    });
    expect((await listMyEventsAsUserAccount(db, owner.proof, new Date(now.getTime() + 2000))).status)
      .toBe("unauthorized");
    expect((await authenticatePairingAdminSession(db, { sessionToken: entered.sessionToken,
      raceId: created.response.raceId, capability: "MANAGE_RACE" }, new Date(now.getTime() + 2000))).status)
      .toBe("unauthorized");
  });

  it("begränsar felaktig inloggning beständigt, även när rätt lösenord senare anges", async () => {
    const installation = await provisionUserAccount(db, {
      loginName: `throttle.${randomUUID().slice(0, 8)}`, displayName: "Test av spärr"
    }, { now });
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await loginUserAccount(db, { formatVersion: 1, loginName: installation.loginName,
        password: "felaktigt lösenord" }, { now: new Date(now.getTime() + attempt * 1000) })).status)
        .toBe("unauthorized");
    }
    expect((await loginUserAccount(db, { formatVersion: 1, loginName: installation.loginName,
      password: installation.initialPassword }, { now: new Date(now.getTime() + 5000) })).status)
      .toBe("unauthorized");
    expect((await loginUserAccount(db, { formatVersion: 1, loginName: installation.loginName,
      password: installation.initialPassword }, { now: new Date(now.getTime() + 16 * 60 * 1000) })).status)
      .toBe("authenticated");
  });
});
