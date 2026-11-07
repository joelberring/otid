import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { ACCOUNT_THROTTLE_SCOPES, consumeAccountRequestAllowance, throttleKeyHash, type AccountThrottleScope } from "../../src/account-throttle";
import { deleteAccountWithOwnedEvents } from "../../src/account-self-service";
import { registerUserAccountWithVerification } from "../../src/email-verification";
import { readInvitationLink } from "../../src/invitation-links";
import { resendGroupInvitation } from "../../src/invitation-resend";
import { acceptGroupInvitations } from "../../src/training-group-invitations";
import { addGroupMember, createTrainingGroup, readGroupAsLeader } from "../../src/training-groups";
import { registerTestAccount } from "./accounts";

/**
 * Städrundan 2026-11-07, paket C5 (migration 0087): spärrens scope bestäms i koden, en gruppinbjudan överlever att ledaren som
 * skickade den tar bort sitt konto (K4), och bekräftelselänken sparar inte längre lösenordets verifierare.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_c5_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-07T10:00:00Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 120_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_c5_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

describe("C5: spärrens scope", { timeout: 120_000 }, () => {
  it("varje scope som koden har går att räkna i databasen", async () => {
    expect(ACCOUNT_THROTTLE_SCOPES.length).toBeGreaterThanOrEqual(13);
    for (const scope of ACCOUNT_THROTTLE_SCOPES) {
      expect(await db.transaction(tx => consumeAccountRequestAllowance(tx, { scope, key: `nyckel-${scope}`, limit: 1 }, NOW)), scope).toBe(true);
      expect(await db.transaction(tx => consumeAccountRequestAllowance(tx, { scope, key: `nyckel-${scope}`, limit: 1 }, NOW)), scope).toBe(false);
    }
    const rows = await db.select({ scope: schema.accountRequestThrottles.scope }).from(schema.accountRequestThrottles);
    expect(new Set(rows.map(row => row.scope))).toEqual(new Set(ACCOUNT_THROTTLE_SCOPES));
  });

  it("ett nytt scope behöver ingen migration: databasen kräver bara formen, koden vägrar okända", async () => {
    const insert = (scope: string) => pool.query("insert into account_request_throttle (scope, key_hash, window_started_at, attempts) values ($1, $2, $3, 1)",
      [scope, "f".repeat(64), NOW]);
    // Före 0087 stoppade CHECK-listan varje scope som inte kopierats in i den.
    await expect(insert("ETT_FRAMTIDA_SCOPE")).resolves.toMatchObject({ rowCount: 1 });
    for (const malformed of ["", "litet", "MED MELLANSLAG", "_LEDANDE", "A".repeat(65)]) {
      await expect(insert(malformed), malformed).rejects.toMatchObject({ code: "23514" });
    }
    expect(() => throttleKeyHash("ETT_FRAMTIDA_SCOPE" as AccountThrottleScope, "nyckel")).toThrow(/Okänt scope/);
    await expect(db.transaction(tx => consumeAccountRequestAllowance(tx, { scope: "OKANT" as AccountThrottleScope, key: "x", limit: 1 }, NOW)))
      .rejects.toThrow(/Okänt scope/);
  });
});

describe("C5/K4: en gruppinbjudan när ledaren som skickade den tar bort sitt konto", { timeout: 120_000 }, () => {
  it("står kvar, kan skickas igen av en annan ledare och blir ett medlemskap", async () => {
    const leaderA = await registerTestAccount(db, undefined, NOW);
    const leaderB = await registerTestAccount(db, undefined, NOW);
    const created = await createTrainingGroup(db, { ...leaderA.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "Torsdagsgruppen",
      code: `torsdag-${randomUUID().slice(0, 8)}` } }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    const groupId = created.group.groupId;
    // B blir ledare (så att A inte är ensam ledare och får ta bort kontot).
    expect((await addGroupMember(db, { ...leaderA.proof, groupId, request: { formatVersion: 1, requestId: randomUUID(), email: leaderB.email,
      role: "LEADER" } }, NOW)).status).toBe("added");
    expect(await db.transaction(tx => acceptGroupInvitations(tx, leaderB.accountId, NOW))).toBe(1);
    const email = `ny.medlem.${randomUUID().slice(0, 8)}@test.o-tid.se`;
    const invited = await addGroupMember(db, { ...leaderA.proof, groupId, request: { formatVersion: 1, requestId: randomUUID(), email, role: "MEMBER" } },
      later(1));
    if (invited.status !== "added") throw new Error(invited.status);

    await db.transaction(tx => deleteAccountWithOwnedEvents(tx, leaderA.accountId, later(2)));
    expect((await pool.query("select 1 from user_account where id = $1", [leaderA.accountId])).rowCount).toBe(0);

    // Före 0087 tog borttagningen (som följer nycklarna) med sig inbjudan.
    const [row] = await db.select().from(schema.trainingGroupInvitations).where(eq(schema.trainingGroupInvitations.id, invited.member.memberId));
    expect(row).toMatchObject({ email, actorAccountId: leaderA.accountId, acceptedAt: null, revokedAt: null });
    const view = await readGroupAsLeader(db, { ...leaderB.proof, groupId }, later(3));
    if (view.status !== "ok") throw new Error(view.status);
    expect(view.view.members.find(member => member.email === email)).toMatchObject({ pending: true, role: "MEMBER" });

    // En annan ledare kan skicka inbjudan igen; länksidan visar den ledaren.
    const resent = await resendGroupInvitation(db, { ...leaderB.proof, groupId, invitationId: invited.member.memberId,
      request: { formatVersion: 1, delivery: "LINK" } }, undefined, later(3));
    if (resent.status !== "ok" || resent.response.status !== "link") throw new Error(JSON.stringify(resent));
    const link = await readInvitationLink(db, resent.response.token, later(4));
    expect(link).toMatchObject({ status: "valid", kind: "GROUP", targetName: "Torsdagsgruppen", email });
    expect(link.status === "valid" && link.inviterName).toBe(`Arrangör ${leaderB.email.split("@")[0]}`);

    // Personen loggar in med adressen och blir medlem, med den borttagna ledaren som den som lade till.
    const member = await registerTestAccount(db, email.split("@")[0], later(5));
    expect(await db.transaction(tx => acceptGroupInvitations(tx, member.accountId, later(5)))).toBe(1);
    const [membership] = (await pool.query<{ role: string; added_by: string }>(
      "select role, added_by from training_group_member where group_id = $1 and account_id = $2", [groupId, member.accountId])).rows;
    expect(membership).toEqual({ role: "MEMBER", added_by: leaderA.accountId });
    const after = await readGroupAsLeader(db, { ...leaderB.proof, groupId }, later(6));
    expect(after.status === "ok" && after.view.members.find(item => item.email === email)).toMatchObject({ pending: false, accountId: member.accountId });
  });
});

describe("C5: bekräftelselänken (ADR-0205, steg 1 av 2)", { timeout: 120_000 }, () => {
  it("sparar inte lösenordets verifierare, och kolumnerna tål en äldre version som skriver dem", async () => {
    const email = `bekrafta.${randomUUID().slice(0, 8)}@test.o-tid.se`;
    const registered = await registerUserAccountWithVerification(db, { formatVersion: 1, email, displayName: "Bekräfta Mig", password: "hemligt-lösen" },
      { now: NOW });
    expect(registered).toMatchObject({ status: "accepted", delivery: { kind: "VERIFY", email } });
    const rows = (await pool.query<{ account_id: string; salt_hex: string | null; verifier_hex: string | null }>(
      "select t.account_id, t.salt_hex, t.verifier_hex from email_verification_token t join user_account a on a.id = t.account_id where a.email = $1",
      [email])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ salt_hex: null, verifier_hex: null });
    // En äldre version (före 0087) skriver fortfarande kolumnerna; formvillkoren gäller som förut.
    await expect(pool.query(`insert into email_verification_token (account_id, token_hash, salt_hex, verifier_hex, created_at, expires_at)
      values ($1, $2, $3, $4, $5, $6)`, [rows[0]!.account_id, "1".repeat(64), "a".repeat(32), "b".repeat(64), NOW, later(60)])).resolves.toMatchObject({ rowCount: 1 });
    await expect(pool.query(`insert into email_verification_token (account_id, token_hash, salt_hex, verifier_hex, created_at, expires_at)
      values ($1, $2, $3, $4, $5, $6)`, [rows[0]!.account_id, "2".repeat(64), "kort", null, NOW, later(60)])).rejects.toMatchObject({ code: "23514" });
  });
});
