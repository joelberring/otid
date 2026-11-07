import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { deleteAccountWithOwnedEvents } from "../../src/account-self-service";
import { readInvitationLink, type InvitationMail } from "../../src/invitation-links";
import { grantRacePersonAsAdmin } from "../../src/race-people";
import { acceptRacePersonInvitations } from "../../src/race-person-invitations";
import { registerTestAccount } from "./accounts";
import { NOW, seedRace } from "./steg-25-fixtures";

/**
 * Städrundan 2026-11-07, paket D (migration 0088): en tävlingsinbjudan och länken i mejlet överlever att administratören som
 * skickade dem tar bort sitt konto (som K4 för gruppinbjudan i 0087).
 */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe("D: tävlingsinbjudan när administratören som skickade den tar bort sitt konto", { timeout: 60_000 }, () => {
  it("inbjudan och länken står kvar, länksidan visar den utan namn och personen får behörigheten", async () => {
    const { ids } = await seedRace(db, pool);
    const sender = await registerTestAccount(db, undefined, NOW);
    await pool.query("insert into event_administration_grant (event_id, account_id, role, granted_at) values ($1, $2, 'ADMIN', now())",
      [ids.event, sender.accountId]);
    const email = `ny.funktionar.${randomUUID().slice(0, 8)}@test.o-tid.se`;
    const mails: InvitationMail[] = [];
    const requestId = randomUUID();
    const granted = await grantRacePersonAsAdmin(db, { ...sender.proof, raceId: ids.race, idempotencyKey: `race-person-grant:${requestId}`,
      readBody: async () => ({ formatVersion: 1, requestId, email, role: "FUNCTIONARY" }) }, later(1), async mail => { mails.push(mail); });
    if (granted.status !== "granted") throw new Error(granted.status);
    expect(granted.response.mail).toBe("sent");
    expect(mails).toHaveLength(1);

    await db.transaction(tx => deleteAccountWithOwnedEvents(tx, sender.accountId, later(2)));
    expect((await pool.query("select 1 from user_account where id = $1", [sender.accountId])).rowCount).toBe(0);

    // Före 0088 tog borttagningen (som följer nycklarna) med sig inbjudan och länken i mejlet.
    expect((await pool.query("select actor_account_id from race_person_invitation where id = $1 and accepted_at is null and revoked_at is null",
      [granted.response.invitation.invitationId])).rows).toEqual([{ actor_account_id: sender.accountId }]);
    const link = await readInvitationLink(db, mails[0]!.token, later(3));
    expect(link).toMatchObject({ status: "valid", kind: "RACE", email, role: "FUNCTIONARY", inviterName: null });

    // Personen loggar in med adressen och blir funktionär.
    const person = await registerTestAccount(db, email.split("@")[0], later(4));
    expect(await db.transaction(tx => acceptRacePersonInvitations(tx, person.accountId, later(4), ids.race))).toBe(1);
    expect((await pool.query("select role from event_administration_grant where event_id = $1 and account_id = $2", [ids.event, person.accountId])).rows)
      .toEqual([{ role: "FUNCTIONARY" }]);
  });
});
