import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, schema } from "@o-tid/database";
import {
  accountPasswordRecoveryStatus,
  issueAccountPasswordRecovery,
  redeemAccountPasswordRecovery,
  revokeAccountPasswordRecovery
} from "../../src/account-password-recovery";
import { createEventAsUserAccount, enterRaceAsUserAccount, listMyEventsAsUserAccount } from "../../src/organizer-events";
import { authenticatePairingAdminSession, issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { issueParticipantEntryClaimAsAdmin, redeemParticipantEntryClaimAsAccount } from "../../src/participant-entry-claim";
import { loginUserAccount, provisionUserAccount, authenticateUserAccountSession } from "../../src/user-account";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("TASK161 kräver uttrycklig TEST_DATABASE_URL till en isolerad PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_task161_spec_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const now = new Date();

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_task161_spec_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig syntetisk testdatabas");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

async function account(loginName: string) {
  const installed = await provisionUserAccount(db, { loginName, displayName: `Syntetiskt ${loginName}` }, { now });
  const result = await loginUserAccount(db, {
    formatVersion: 1, loginName, password: installed.initialPassword
  }, { now });
  if (result.status !== "authenticated") throw new Error("Syntetiskt konto kunde inte logga in");
  return {
    ...installed,
    proof: { sessionToken: result.sessionToken, csrfCookie: result.csrfToken, csrfHeader: result.csrfToken }
  };
}

function issueInput(accountId: string, loginName: string, code: Buffer, requestId = randomUUID(), lifetimeMs = 12 * 60 * 60 * 1_000) {
  return {
    formatVersion: 1 as const, requestId, accountId, loginName,
    operatorLabel: "TASK161 synthetic operator", reason: "Syntetiskt integrationstest",
    codeHash: hash(code), expiresAt: new Date(now.getTime() + lifetimeMs).toISOString()
  };
}

function redeemInput(loginName: string, code: Buffer, password: Buffer, requestId = randomUUID()) {
  return { formatVersion: 1 as const, requestId, loginName,
    code: code.toString("base64url"), password: password.toString("base64url") };
}

describe("TASK161 betrodd lösenordsåterställning av befintligt konto", () => {
  it("gör issue och inlösen idempotenta, spärrar gamla delegeringar och bevarar eventkopplingar", async () => {
    const owner = await account(`owner.${randomUUID().slice(0, 8)}`);
    const event = await createEventAsUserAccount(db, {
      ...owner.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Syntetiskt TASK161", raceName: "Lång",
        raceDate: "2026-09-24", timeZone: "Europe/Stockholm" })
    }, now);
    if (event.status !== "created") throw new Error("Syntetiskt event kunde inte skapas");
    const priorGrants = await db.select({ id: schema.eventAdministrationGrants.id, role: schema.eventAdministrationGrants.role })
      .from(schema.eventAdministrationGrants).where(eq(schema.eventAdministrationGrants.accountId, owner.accountId));
    const delegation = await enterRaceAsUserAccount(db, { ...owner.proof, raceId: event.response.raceId }, now);
    expect(delegation.status).toBe("entered");
    if (delegation.status !== "entered") return;

    const courseId = randomUUID(), courseVersionId = randomUUID(), classId = randomUUID(), entryId = randomUUID();
    await db.insert(schema.courses).values({ id: courseId, raceId: event.response.raceId, name: "Syntetisk bana" });
    await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
    await db.insert(schema.classes).values({ id: classId, raceId: event.response.raceId,
      courseVersionId, name: "Öppen", startRule: "PUNCH" });
    await db.insert(schema.entries).values({ id: entryId, raceId: event.response.raceId,
      classId, givenName: "Syntetisk", familyName: "Deltagare" });
    const access = await issuePairingAdminAccessCredential(db, {
      raceId: event.response.raceId, capability: "MANAGE_RACE", label: "TASK161 claim fixture",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1_000)
    }, { now });
    const adminLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: access.accessCredential }, {
      expectedRaceId: event.response.raceId, expectedCapability: "MANAGE_RACE", now
    });
    if (adminLogin.status !== "authenticated") throw new Error("Syntetisk claimadministratör saknas");
    const adminProof = { raceId: event.response.raceId, sessionToken: adminLogin.sessionToken,
      csrfCookie: adminLogin.csrfToken, csrfHeader: adminLogin.csrfToken };
    const claimSecret = randomBytes(16), claimRequestId = randomUUID();
    const claim = await issueParticipantEntryClaimAsAdmin(db, { ...adminProof, entryId,
      idempotencyKey: `participant-claim-issue:${claimRequestId}`,
      request: { formatVersion: 1, requestId: claimRequestId, raceId: event.response.raceId, entryId,
        secretHash: hash(claimSecret), expiresAt: new Date(now.getTime() + 60 * 60 * 1_000).toISOString(),
        attestation: "IDENTITY_CHECKED" }
    }, now);
    expect(claim.status).toBe("issued");
    if (claim.status !== "issued") return;
    const claimRedemptionId = randomUUID();
    expect(await redeemParticipantEntryClaimAsAccount(db, { ...owner.proof,
      idempotencyKey: `participant-claim-redeem:${claimRedemptionId}`,
      request: { formatVersion: 1, requestId: claimRedemptionId, code: claimSecret.toString("base64url") }
    }, now)).toMatchObject({ status: "redeemed" });
    const priorClaims = await db.select({ id: schema.participantEntryClaimRedemptions.claimId,
      accountId: schema.participantEntryClaimRedemptions.accountId })
      .from(schema.participantEntryClaimRedemptions)
      .where(eq(schema.participantEntryClaimRedemptions.accountId, owner.accountId));

    const code = randomBytes(32);
    const intent = issueInput(owner.accountId, owner.loginName, code);
    const issued = await issueAccountPasswordRecovery(db, intent, now);
    expect(issued.status).toBe("issued");
    if (issued.status !== "issued") return;
    expect(await issueAccountPasswordRecovery(db, intent, new Date(now.getTime() + 1)))
      .toMatchObject({ status: "issued", response: { recoveryId: issued.response.recoveryId } });
    expect((await issueAccountPasswordRecovery(db, { ...intent, reason: "ändrat" }, now)).status).toBe("conflict");
    expect((await issueAccountPasswordRecovery(db, issueInput(owner.accountId, owner.loginName, randomBytes(32)), now)).status)
      .toBe("conflict");
    expect(await accountPasswordRecoveryStatus(db, issued.response.recoveryId, now))
      .toMatchObject({ status: "ok", response: { status: "PENDING", accountId: owner.accountId } });
    expect((await issueAccountPasswordRecovery(db, issueInput(randomUUID(), owner.loginName, randomBytes(32)), now)).status)
      .toBe("not-found");

    const wrong = await redeemAccountPasswordRecovery(db,
      redeemInput(owner.loginName, randomBytes(32), randomBytes(32)), { now });
    expect(wrong.status).toBe("invalid");

    const nextPassword = randomBytes(32);
    const redemptionA = redeemInput(owner.loginName, code, nextPassword);
    const redemptionB = redeemInput(owner.loginName, code, nextPassword);
    const competing = await Promise.all([
      redeemAccountPasswordRecovery(db, redemptionA, { now, saltBytes: Buffer.alloc(16, 1) }),
      redeemAccountPasswordRecovery(db, redemptionB, { now, saltBytes: Buffer.alloc(16, 2) })
    ]);
    expect(competing.filter(result => result.status === "recovered")).toHaveLength(1);
    expect(competing.filter(result => result.status === "invalid")).toHaveLength(1);
    const winner = competing.find(result => result.status === "recovered");
    if (winner?.status !== "recovered") return;
    const winnerInput = competing[0]?.status === "recovered" ? redemptionA : redemptionB;
    const winnerSalt = competing[0]?.status === "recovered" ? Buffer.alloc(16, 1) : Buffer.alloc(16, 2);
    expect(await redeemAccountPasswordRecovery(db, winnerInput,
      { now: new Date(now.getTime() + 1), saltBytes: winnerSalt }))
      .toMatchObject({ status: "recovered", response: { passwordVersion: 2 } });
    expect((await redeemAccountPasswordRecovery(db,
      { ...winnerInput, password: randomBytes(32).toString("base64url") }, { now })).status).toBe("conflict");
    expect(await accountPasswordRecoveryStatus(db, issued.response.recoveryId, now))
      .toMatchObject({ status: "ok", response: { status: "REDEEMED" } });
    expect(await redeemAccountPasswordRecovery(db,
      redeemInput(owner.loginName, code, randomBytes(32)), { now })).toMatchObject({ status: "invalid" });

    expect(await authenticateUserAccountSession(db, owner.proof, now)).toEqual({ status: "unauthorized" });
    expect(await listMyEventsAsUserAccount(db, owner.proof, now)).toEqual({ status: "unauthorized" });
    expect(await authenticatePairingAdminSession(db, { raceId: event.response.raceId, capability: "MANAGE_RACE",
      sessionToken: delegation.sessionToken }, now)).toEqual({ status: "unauthorized" });
    expect((await loginUserAccount(db, { formatVersion: 1, loginName: owner.loginName,
      password: owner.initialPassword }, { now })).status).toBe("unauthorized");
    const freshLogin = await loginUserAccount(db, { formatVersion: 1, loginName: owner.loginName,
      password: nextPassword.toString("base64url") }, { now });
    expect(freshLogin.status).toBe("authenticated");
    expect(await db.select({ id: schema.eventAdministrationGrants.id, role: schema.eventAdministrationGrants.role })
      .from(schema.eventAdministrationGrants).where(eq(schema.eventAdministrationGrants.accountId, owner.accountId)))
      .toEqual(priorGrants);
    expect(await db.select({ id: schema.participantEntryClaimRedemptions.claimId,
      accountId: schema.participantEntryClaimRedemptions.accountId })
      .from(schema.participantEntryClaimRedemptions)
      .where(eq(schema.participantEntryClaimRedemptions.accountId, owner.accountId))).toEqual(priorClaims);
    expect(await db.select().from(schema.userAccountPasswordVerifiers)
      .where(eq(schema.userAccountPasswordVerifiers.accountId, owner.accountId))).toHaveLength(2);
    expect(await db.select().from(schema.accountPasswordRecoveryRedemptions)
      .where(eq(schema.accountPasswordRecoveryRedemptions.recoveryId, issued.response.recoveryId))).toHaveLength(1);
  });

  it("spärrar utfärdanden, hanterar utgångstid och behåller beständig gissningsspärr", async () => {
    const revokedAccount = await account(`revoked.${randomUUID().slice(0, 8)}`);
    const revokedCode = randomBytes(32);
    const revokedIssue = await issueAccountPasswordRecovery(db,
      issueInput(revokedAccount.accountId, revokedAccount.loginName, revokedCode), now);
    expect(revokedIssue.status).toBe("issued");
    if (revokedIssue.status !== "issued") return;
    const revokeInput = { formatVersion: 1 as const, requestId: randomUUID(),
      recoveryId: revokedIssue.response.recoveryId, operatorLabel: "TASK161 synthetic operator", reason: "Förlorad kod" };
    expect(await revokeAccountPasswordRecovery(db, revokeInput, now)).toMatchObject({ status: "revoked" });
    expect(await revokeAccountPasswordRecovery(db, revokeInput, new Date(now.getTime() + 1)))
      .toMatchObject({ status: "revoked", response: { recoveryId: revokedIssue.response.recoveryId } });
    expect((await revokeAccountPasswordRecovery(db, { ...revokeInput, reason: "annat" }, now)).status).toBe("conflict");
    expect(await accountPasswordRecoveryStatus(db, revokedIssue.response.recoveryId, now))
      .toMatchObject({ status: "ok", response: { status: "REVOKED" } });
    expect((await redeemAccountPasswordRecovery(db,
      redeemInput(revokedAccount.loginName, revokedCode, randomBytes(32)), { now })).status).toBe("invalid");

    const expiredAccount = await account(`expired.${randomUUID().slice(0, 8)}`);
    const expiredCode = randomBytes(32);
    const expiry = new Date(now.getTime() + 1_000);
    const expiredIntent = { ...issueInput(expiredAccount.accountId, expiredAccount.loginName, expiredCode), expiresAt: expiry.toISOString() };
    const expiredIssue = await issueAccountPasswordRecovery(db, expiredIntent, now);
    expect(expiredIssue.status).toBe("issued");
    if (expiredIssue.status !== "issued") return;
    expect(await accountPasswordRecoveryStatus(db, expiredIssue.response.recoveryId, expiry))
      .toMatchObject({ status: "ok", response: { status: "EXPIRED" } });
    expect((await redeemAccountPasswordRecovery(db,
      redeemInput(expiredAccount.loginName, expiredCode, randomBytes(32)), { now: expiry })).status).toBe("invalid");

    const unknownLogin = `missing.${randomUUID().slice(0, 8)}`;
    const unknownCode = randomBytes(32);
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await redeemAccountPasswordRecovery(db,
        redeemInput(unknownLogin, unknownCode, randomBytes(32)), { now: new Date(now.getTime() + attempt) })).status)
        .toBe("invalid");
    }
    expect((await redeemAccountPasswordRecovery(db,
      redeemInput(unknownLogin, unknownCode, randomBytes(32)), { now: new Date(now.getTime() + 10) })).status)
      .toBe("invalid");
    const throttle = await db.select().from(schema.accountPasswordRecoveryThrottles);
    expect(throttle).toHaveLength(4); // The two terminal-code attempts, the reset main-account row, and unknown login; keys are hashed.
    const unknownThrottle = throttle.find(row => row.loginKeyHash === hash(unknownLogin));
    expect(unknownThrottle).toMatchObject({ failedAttempts: 5 });
    expect(unknownThrottle?.blockedUntil?.getTime()).toBeGreaterThan(now.getTime());
  });
});
