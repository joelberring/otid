import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { changeAccountPassword } from "../../src/account-self-service";
import { exchangeOauthToken, pkceChallenge } from "../../src/oauth";
import { completePasswordReset, requestPasswordReset } from "../../src/password-reset";
import { createOrganizerEvent } from "../../src/organizer-events";
import { saveRacePrintFile } from "../../src/race-print-files";
import { consumeIpRequestAllowance } from "../../src/account-throttle";
import { authenticateAccountSessionForWrite, logoutAllUserAccountSessions } from "../../src/user-account";
import { accountOnRace, registerTestAccount, TEST_PASSWORD } from "./accounts";

/**
 * Säkerhetsgranskningen (batch 3): sessionen prövas före stora kroppar (3.1), AI-kopplingar återkallas när inloggningen
 * återkallas och en spärrad ägare kan inte lösa in en kod (3.4), tryckjobbens PDF:er kopieras bara av administratören (3.5)
 * och spärren per IP-adress för öppna anrop (3.9).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_granskning3_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const RESOURCE = "https://tid.example/api/mcp";

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
  await db.insert(schema.oauthClients).values({ id: "klient-granskning-1", name: "Claude", redirectUris: ["https://claude.example/cb"], createdAt: new Date() });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_granskning3_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function grantFor(accountId: string) {
  const id = randomUUID(), now = new Date();
  await db.insert(schema.oauthGrants).values({ id, accountId, clientId: "klient-granskning-1", clientName: "Claude", scope: "mcp", resource: RESOURCE,
    accessSha256: sha256(`a${id}`), accessExpiresAt: new Date(now.getTime() + 3_600_000), refreshSha256: sha256(`r${id}`),
    refreshExpiresAt: new Date(now.getTime() + 30 * 86_400_000), createdAt: now });
  return id;
}
const revoked = async (grantId: string) => (await db.select({ at: schema.oauthGrants.revokedAt }).from(schema.oauthGrants)
  .where(eq(schema.oauthGrants.id, grantId)))[0]?.at !== null;

describe("3.1: sessionen prövas före kroppen", () => {
  it("ogiltig kaka ger unauthorized, fel CSRF forbidden, rätt par authenticated", async () => {
    const account = await registerTestAccount(db);
    expect((await authenticateAccountSessionForWrite(db, { sessionToken: "x".repeat(40), csrfCookie: "y", csrfHeader: "y" })).status).toBe("unauthorized");
    expect((await authenticateAccountSessionForWrite(db, { sessionToken: null })).status).toBe("unauthorized");
    expect((await authenticateAccountSessionForWrite(db, { sessionToken: account.proof.sessionToken, csrfCookie: account.proof.csrfCookie, csrfHeader: "fel" })).status).toBe("forbidden");
    expect((await authenticateAccountSessionForWrite(db, account.proof)).status).toBe("authenticated");
  });
});

describe("3.4: AI-kopplingar följer inloggningen", () => {
  it("lösenordsåterställning, lösenordsbyte och Logga ut överallt återkallar kopplingarna och oanvända koder", async () => {
    const reset = await registerTestAccount(db);
    const resetGrant = await grantFor(reset.accountId);
    const requested = await requestPasswordReset(db, { formatVersion: 1, email: reset.email }, { clientKey: "203.0.113.5" });
    if (requested.status !== "accepted" || !requested.delivery) throw new Error("Ingen återställning");
    expect((await completePasswordReset(db, { formatVersion: 1, token: requested.delivery.token, password: "nytt-lösen-123" })).status).toBe("authenticated");
    expect(await revoked(resetGrant)).toBe(true);

    const change = await registerTestAccount(db);
    const changeGrant = await grantFor(change.accountId);
    await db.insert(schema.oauthCodes).values({ codeSha256: sha256(`kod${change.accountId}`), clientId: "klient-granskning-1", accountId: change.accountId,
      redirectUri: "https://claude.example/cb", codeChallenge: pkceChallenge("w".repeat(50)), scope: "mcp", createdAt: new Date(), expiresAt: new Date(Date.now() + 600_000) });
    expect((await changeAccountPassword(db, change.proof, { formatVersion: 1, currentPassword: TEST_PASSWORD, newPassword: "annat-lösen-456" })).status).toBe("authenticated");
    expect(await revoked(changeGrant)).toBe(true);
    const [code] = await db.select({ usedAt: schema.oauthCodes.usedAt }).from(schema.oauthCodes).where(eq(schema.oauthCodes.accountId, change.accountId));
    expect(code?.usedAt).not.toBeNull();

    const everywhere = await registerTestAccount(db);
    const everywhereGrant = await grantFor(everywhere.accountId);
    expect(await logoutAllUserAccountSessions(db, everywhere.proof)).toMatchObject({ status: "logged-out" });
    expect(await revoked(everywhereGrant)).toBe(true);

    // Ett annat konto berörs inte.
    const other = await registerTestAccount(db);
    const otherGrant = await grantFor(other.accountId);
    expect(await revoked(otherGrant)).toBe(false);
  }, 60_000);

  it("en kod kan inte lösas in när kontot har spärrats efter godkännandet", async () => {
    const owner = await registerTestAccount(db);
    const verifier = "v".repeat(50), code = `otid_c_${randomUUID()}`;
    const insert = () => db.insert(schema.oauthCodes).values({ codeSha256: sha256(code), clientId: "klient-granskning-1", accountId: owner.accountId,
      redirectUri: "https://claude.example/cb", codeChallenge: pkceChallenge(verifier), scope: "mcp", resource: RESOURCE, createdAt: new Date(),
      expiresAt: new Date(Date.now() + 600_000) });
    const form = { grant_type: "authorization_code", code, client_id: "klient-granskning-1", redirect_uri: "https://claude.example/cb", code_verifier: verifier };
    await insert();
    await db.update(schema.userAccounts).set({ blockedAt: new Date() }).where(eq(schema.userAccounts.id, owner.accountId));
    const blocked = await exchangeOauthToken(db, { form, ip: "198.51.100.1", resource: RESOURCE });
    expect(blocked).toMatchObject({ error: "invalid_grant" });
    expect(await db.select().from(schema.oauthGrants).where(eq(schema.oauthGrants.accountId, owner.accountId))).toEqual([]);
    // Utan spärr går samma kod igenom (kontrollen).
    await db.update(schema.userAccounts).set({ blockedAt: null }).where(eq(schema.userAccounts.id, owner.accountId));
    await db.delete(schema.oauthCodes).where(eq(schema.oauthCodes.codeSha256, sha256(code)));
    await insert();
    expect((await exchangeOauthToken(db, { form, ip: "198.51.100.1", resource: RESOURCE })).status).toBe("ok");
  });
});

describe("3.5: tryckjobbens PDF kopieras bara av administratören", () => {
  it("den som bara får ändra får forbidden för fromJobId, men får spara en egen PDF; administratören når jobbet", async () => {
    const owner = await registerTestAccount(db);
    const created = await createOrganizerEvent(db, { ...owner.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Tryck", raceName: "Torsdag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
    if (created.status !== "created") throw new Error("Ingen tävling");
    const raceId = created.response.raceId;
    const ownerOnRace = await accountOnRace(db, { ...owner.proof, raceId });
    if (ownerOnRace.status !== "authenticated") throw new Error("Kom inte in");
    const ownerProof = { raceId, sessionToken: ownerOnRace.sessionToken, csrfCookie: ownerOnRace.csrfToken, csrfHeader: ownerOnRace.csrfToken };
    const editor = await registerTestAccount(db);
    await db.insert(schema.courseSettingGrants).values({ id: randomUUID(), raceId, accountId: editor.accountId, level: "EDIT", grantedAt: new Date(),
      grantedBy: owner.accountId, requestId: randomUUID() });
    const editorProof = { raceId, ...editor.proof };
    const jobId = randomUUID();
    expect(await saveRacePrintFile(db, { ...editorProof, fileName: "x", label: "", fromJobId: jobId })).toEqual({ status: "forbidden" });
    expect(await saveRacePrintFile(db, { ...ownerProof, fileName: "x", label: "", fromJobId: jobId })).toEqual({ status: "not-found" });
    expect(await saveRacePrintFile(db, { ...editorProof, fileName: "Egen", label: "", pdf: new TextEncoder().encode("%PDF-1.4 x") })).toMatchObject({ status: "ok" });
  });
});

describe("3.9: spärr per IP-adress", () => {
  it("släpper igenom upp till gränsen och spärrar sedan, per scope och adress", async () => {
    const ip = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
    for (let call = 0; call < 3; call += 1) expect(await consumeIpRequestAllowance(db, "INVITATION_LINK_IP", ip, 3)).toBe(true);
    expect(await consumeIpRequestAllowance(db, "INVITATION_LINK_IP", ip, 3)).toBe(false);
    expect(await consumeIpRequestAllowance(db, "MAP_PROJECT_LINK_IP", ip, 3)).toBe(true);
    expect(await consumeIpRequestAllowance(db, "OAUTH_REVOKE_IP", ip, 1)).toBe(true);
    expect(await consumeIpRequestAllowance(db, "OAUTH_REVOKE_IP", ip, 1)).toBe(false);
  });
});
