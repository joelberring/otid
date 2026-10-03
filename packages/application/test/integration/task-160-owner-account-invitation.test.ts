import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, schema } from "@o-tid/database";
import { activateAccountInvitation } from "../../src/account-invitation";
import {
  issueEventAccountInvitationAsOwner,
  listEventAccountInvitationsAsOwner,
  revokeEventAccountInvitationAsOwner
} from "../../src/organizer-account-invitation";
import { createEventAsUserAccount, enterRaceAsUserAccount, listMyEventsAsUserAccount } from "../../src/organizer-events";
import { grantEventAdministratorAsUserAccount } from "../../src/organizer-coadministration";
import { loginUserAccount, provisionUserAccount } from "../../src/user-account";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("TASK160 kräver uttrycklig TEST_DATABASE_URL till en isolerad PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_task160_spec_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_task160_spec_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const now = new Date("2026-09-23T10:00:00.000Z");

async function account(loginName: string) {
  const installation = await provisionUserAccount(db, {
    loginName, displayName: `Syntetiskt konto ${loginName}`
  }, { now });
  const login = await loginUserAccount(db, {
    formatVersion: 1, loginName, password: installation.initialPassword
  }, { now });
  if (login.status !== "authenticated") throw new Error("Syntetiskt konto kunde inte logga in");
  return {
    installation,
    proof: { sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken }
  };
}

function createEvent(proof: Awaited<ReturnType<typeof account>>["proof"], name: string) {
  return createEventAsUserAccount(db, {
    ...proof,
    idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: name, raceName: "Lång",
      raceDate: "2026-09-24", timeZone: "Europe/Stockholm" })
  }, now);
}

function issue(proof: Awaited<ReturnType<typeof account>>["proof"], eventId: string,
  loginName: string, code: Buffer, requestId = randomUUID(), displayName = `Inbjuden ${loginName}`) {
  const body = { formatVersion: 1, requestId, eventId, loginName, displayName,
    codeHash: createHash("sha256").update(code).digest("hex") };
  return { requestId, body, input: {
    ...proof, idempotencyKey: `organizer-account-invitation-issue:${requestId}`,
    readBody: async () => body
  } };
}

function revoke(proof: Awaited<ReturnType<typeof account>>["proof"], eventId: string,
  invitationId: string, requestId = randomUUID()) {
  const body = { formatVersion: 1, requestId, eventId, invitationId, reason: "Syntetiskt test" };
  return { body, input: {
    ...proof, invitationId, idempotencyKey: `organizer-account-invitation-revoke:${requestId}`,
    readBody: async () => body
  } };
}

describe("TASK160 ägarstyrd kontoinbjudan med separat ADMIN-beslut", () => {
  it("aktiverar ett konto utan rättighet tills OWNER uttryckligen ger ADMIN enligt A2", async () => {
    const owner = await account(`owner.${randomUUID().slice(0, 8)}`);
    const otherOwner = await account(`owner.${randomUUID().slice(0, 8)}`);
    const existingAdmin = await account(`admin.${randomUUID().slice(0, 8)}`);
    const eventResult = await createEvent(owner.proof, "Syntetiskt event TASK160");
    const otherEventResult = await createEvent(otherOwner.proof, "Annat syntetiskt event");
    if (eventResult.status !== "created" || otherEventResult.status !== "created") {
      throw new Error("Syntetiskt event kunde inte skapas");
    }
    const eventId = eventResult.response.eventId;
    const raceId = eventResult.response.raceId;
    const adminRequestId = randomUUID();
    const assignedAdmin = await grantEventAdministratorAsUserAccount(db, {
      ...owner.proof, idempotencyKey: `organizer-admin-grant:${adminRequestId}`,
      readBody: async () => ({ formatVersion: 1, requestId: adminRequestId, eventId,
        loginName: existingAdmin.installation.loginName, role: "ADMIN" })
    }, now);
    expect(assignedAdmin.status).toBe("granted");

    const loginName = `new.admin.${randomUUID().slice(0, 8)}`;
    const code = randomBytes(32);
    const intent = issue(owner.proof, eventId, loginName, code);
    const issued = await issueEventAccountInvitationAsOwner(db, intent.input, now);
    expect(issued.status).toBe("issued");
    if (issued.status !== "issued") return;
    const replay = await issueEventAccountInvitationAsOwner(db, intent.input, new Date(now.getTime() + 1));
    expect(replay).toMatchObject({ status: "issued", response: {
      invitationId: issued.response.invitationId, replayed: true
    } });
    expect((await issueEventAccountInvitationAsOwner(db,
      issue(owner.proof, eventId, `${loginName}.changed`, code, intent.requestId).input, now)).status).toBe("conflict");
    expect((await issueEventAccountInvitationAsOwner(db,
      issue(otherOwner.proof, eventId, loginName, code, intent.requestId).input, now)).status).toBe("conflict");
    expect((await issueEventAccountInvitationAsOwner(db,
      issue(existingAdmin.proof, eventId, `${loginName}.admin`, randomBytes(32)).input, now)).status).toBe("not-found");
    expect((await listEventAccountInvitationsAsOwner(db, { ...otherOwner.proof, eventId }, now)).status)
      .toBe("not-found");

    const accountCode = code.toString("base64url");
    const activationRequest = { formatVersion: 1 as const, requestId: randomUUID(), loginName,
      code: accountCode, password: randomBytes(32).toString("base64url") };
    const activation = await activateAccountInvitation(db, activationRequest, { now });
    expect(activation.status).toBe("activated");
    if (activation.status !== "activated") return;
    expect(await db.select().from(schema.eventAdministrationGrants)
      .where(eq(schema.eventAdministrationGrants.accountId, activation.response.accountId))).toHaveLength(0);
    const activatedLogin = await loginUserAccount(db, {
      formatVersion: 1, loginName, password: activationRequest.password
    }, { now });
    if (activatedLogin.status !== "authenticated") throw new Error("Det aktiverade kontot kunde inte logga in");
    const activatedProof = { sessionToken: activatedLogin.sessionToken,
      csrfCookie: activatedLogin.csrfToken, csrfHeader: activatedLogin.csrfToken };
    const emptyEvents = await listMyEventsAsUserAccount(db, activatedProof, now);
    expect(emptyEvents).toMatchObject({ status: "ok", response: { formatVersion: 1, events: [] } });
    expect((await enterRaceAsUserAccount(db, { ...activatedProof, raceId }, now)).status).toBe("not-found");

    const grantRequestId = randomUUID();
    const granted = await grantEventAdministratorAsUserAccount(db, {
      ...owner.proof, idempotencyKey: `organizer-admin-grant:${grantRequestId}`,
      readBody: async () => ({ formatVersion: 1, requestId: grantRequestId, eventId,
        loginName, role: "ADMIN" })
    }, new Date(now.getTime() + 1000));
    expect(granted.status).toBe("granted");
    expect((await enterRaceAsUserAccount(db, { ...activatedProof, raceId }, new Date(now.getTime() + 2000))).status)
      .toBe("entered");
    expect((await enterRaceAsUserAccount(db, { ...activatedProof, raceId: otherEventResult.response.raceId },
      new Date(now.getTime() + 2000))).status).toBe("not-found");

    const pendingLoginName = `pending.${randomUUID().slice(0, 8)}`;
    const pendingCode = randomBytes(32);
    const pendingIntent = issue(owner.proof, eventId, pendingLoginName, pendingCode);
    const pending = await issueEventAccountInvitationAsOwner(db, pendingIntent.input, new Date(now.getTime() + 3000));
    expect(pending.status).toBe("issued");
    if (pending.status !== "issued") return;
    expect((await listEventAccountInvitationsAsOwner(db, { ...existingAdmin.proof, eventId }, now)).status)
      .toBe("not-found");
    const deniedRevoke = revoke(existingAdmin.proof, eventId, pending.response.invitationId);
    expect((await revokeEventAccountInvitationAsOwner(db, deniedRevoke.input, new Date(now.getTime() + 3500))).status)
      .toBe("not-found");
    const otherOwnerRevoke = revoke(otherOwner.proof, eventId, pending.response.invitationId);
    expect((await revokeEventAccountInvitationAsOwner(db, otherOwnerRevoke.input,
      new Date(now.getTime() + 3500))).status).toBe("not-found");
    const revokeIntent = revoke(owner.proof, eventId, pending.response.invitationId);
    const revoked = await revokeEventAccountInvitationAsOwner(db, revokeIntent.input, new Date(now.getTime() + 4000));
    expect(revoked.status).toBe("revoked");
    expect(await revokeEventAccountInvitationAsOwner(db, revokeIntent.input, new Date(now.getTime() + 5000)))
      .toMatchObject({ status: "revoked", response: { invitationId: pending.response.invitationId, replayed: true } });
    expect((await activateAccountInvitation(db, { formatVersion: 1, requestId: randomUUID(),
      loginName: pendingLoginName, code: pendingCode.toString("base64url"),
      password: randomBytes(32).toString("base64url") }, { now: new Date(now.getTime() + 6000) })).status)
      .toBe("invalid");
    const listed = await listEventAccountInvitationsAsOwner(db, { ...owner.proof, eventId },
      new Date(now.getTime() + 7000));
    expect(listed).toMatchObject({ status: "ok", response: { invitations: [
      { invitationId: pending.response.invitationId, status: "REVOKED" },
      { invitationId: issued.response.invitationId, status: "REDEEMED" }
    ] } });
    const ownerIssueRows = await db.select().from(schema.eventAccountInvitationIssues)
      .where(eq(schema.eventAccountInvitationIssues.invitationId, pending.response.invitationId));
    expect(ownerIssueRows).toHaveLength(1);
    const ownerRevokeRows = await db.select().from(schema.eventAccountInvitationRevocations)
      .where(eq(schema.eventAccountInvitationRevocations.invitationId, pending.response.invitationId));
    expect(ownerRevokeRows).toHaveLength(1);
  });
});
