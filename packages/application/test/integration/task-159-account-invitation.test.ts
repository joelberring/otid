import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, schema } from "@o-tid/database";
import { activateAccountInvitation, accountInvitationStatus,
  issueAccountInvitation, revokeAccountInvitation } from "../../src/account-invitation";
import { loginUserAccount, provisionUserAccount } from "../../src/user-account";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("TASK159 kräver en uttryckligen isolerad TEST_DATABASE_URL med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_task159_spec_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_task159_spec_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

function intention(loginName: string, code: Buffer, now: Date) {
  return { formatVersion: 1 as const, requestId: randomUUID(), loginName,
    displayName: `Test ${loginName}`, operatorLabel: "Syntetisk operatör",
    codeHash: createHash("sha256").update(code).digest("hex"),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString() };
}

function activation(loginName: string, code: Buffer) {
  return { formatVersion: 1 as const, requestId: randomUUID(), loginName,
    code: code.toString("base64url"), password: randomBytes(32).toString("base64url") };
}

describe("TASK159 betrodd kontoinbjudan", () => {
  it("utfärdar, aktiverar och loggar in utan grant eller anmälningskoppling", async () => {
    const now = new Date();
    const loginName = `invited.${randomUUID().slice(0, 8)}`;
    const code = randomBytes(32);
    const issue = intention(loginName, code, now);
    const issued = await issueAccountInvitation(db, issue, now);
    expect(issued.status).toBe("issued");
    if (issued.status !== "issued") return;
    expect(await issueAccountInvitation(db, issue, now)).toEqual(issued);
    expect(await issueAccountInvitation(db, { ...issue, operatorLabel: "Annan operatör" }, now))
      .toEqual({ status: "conflict" });
    expect((await accountInvitationStatus(db, issued.response.invitationId, now)).status).toBe("ok");
    const input = activation(loginName, code);
    const redeemed = await activateAccountInvitation(db, input, { now });
    expect(redeemed.status).toBe("activated");
    if (redeemed.status !== "activated") return;
    expect(await activateAccountInvitation(db, input, { now })).toEqual(redeemed);
    expect((await activateAccountInvitation(db, { ...input, requestId: randomUUID() }, { now })).status).toBe("invalid");
    const login = await loginUserAccount(db, { formatVersion: 1,
      loginName, password: input.password }, { now });
    expect(login.status).toBe("authenticated");
    expect((await accountInvitationStatus(db, issued.response.invitationId, now))).toMatchObject({
      status: "ok", response: { status: "REDEEMED" }
    });
    expect(await db.select().from(schema.eventAdministrationGrants)
      .where(eq(schema.eventAdministrationGrants.accountId, redeemed.response.accountId))).toHaveLength(0);
    expect(await db.select().from(schema.participantEntryClaimRedemptions)
      .where(eq(schema.participantEntryClaimRedemptions.accountId, redeemed.response.accountId))).toHaveLength(0);
  });

  it("nekar okänd, spärrad och utgången kod samt befintligt namn", async () => {
    const now = new Date();
    const loginName = `revoke.${randomUUID().slice(0, 8)}`;
    const code = randomBytes(32);
    const issued = await issueAccountInvitation(db, intention(loginName, code, now), now);
    if (issued.status !== "issued") throw new Error("Testinbjudan saknas");
    const request = activation(loginName, code);
    expect((await activateAccountInvitation(db, { ...request,
      code: randomBytes(32).toString("base64url") }, { now })).status).toBe("invalid");
    const revoke = { formatVersion: 1 as const, requestId: randomUUID(),
      invitationId: issued.response.invitationId, operatorLabel: "Syntetisk operatör", reason: "Test" };
    expect((await revokeAccountInvitation(db, revoke, now)).status).toBe("revoked");
    expect((await revokeAccountInvitation(db, revoke, now)).status).toBe("revoked");
    expect((await activateAccountInvitation(db, request, { now })).status).toBe("invalid");
    const lateName = `late.${randomUUID().slice(0, 8)}`;
    const lateCode = randomBytes(32);
    const late = intention(lateName, lateCode, now);
    expect((await issueAccountInvitation(db, late, now)).status).toBe("issued");
    expect((await activateAccountInvitation(db, activation(lateName, lateCode), {
      now: new Date(now.getTime() + 2 * 60 * 60 * 1000) })).status).toBe("invalid");
    const existing = await provisionUserAccount(db, {
      loginName: `existing.${randomUUID().slice(0, 8)}`, displayName: "Befintlig" });
    expect((await issueAccountInvitation(db, intention(existing.loginName, randomBytes(32), now), now)).status)
      .toBe("conflict");
  });

  it("begränsar gissningar och ger bara en vinnare vid samtidiga inlösare", async () => {
    const now = new Date();
    const loginName = `throttle.${randomUUID().slice(0, 8)}`;
    const code = randomBytes(32);
    expect((await issueAccountInvitation(db, intention(loginName, code, now), now)).status).toBe("issued");
    for (let index = 0; index < 5; index++) {
      const wrong = activation(loginName, randomBytes(32));
      expect((await activateAccountInvitation(db, wrong, { now })).status).toBe("invalid");
    }
    expect((await activateAccountInvitation(db, activation(loginName, code), { now })).status).toBe("invalid");

    const otherName = `race.${randomUUID().slice(0, 8)}`;
    const otherCode = randomBytes(32);
    expect((await issueAccountInvitation(db, intention(otherName, otherCode, now), now)).status).toBe("issued");
    const [first, second] = await Promise.all([
      activateAccountInvitation(db, activation(otherName, otherCode), { now }),
      activateAccountInvitation(db, activation(otherName, otherCode), { now })
    ]);
    expect([first.status, second.status].sort()).toEqual(["activated", "invalid"]);
    expect(await db.select().from(schema.userAccounts)
      .where(eq(schema.userAccounts.loginName, otherName))).toHaveLength(1);
  });
});
