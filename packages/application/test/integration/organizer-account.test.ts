import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "@o-tid/database";
import { createDatabase, schema } from "@o-tid/database";
import { requireRaceRole } from "../../src/race-session";
import { loginUserAccount, logoutUserAccountSession } from "../../src/user-account";
import { changeAccountPassword } from "../../src/account-self-service";
import { registerTestAccount, accountOnRace } from "./accounts";
import { createOrganizerEvent, listMyEvents } from "../../src/organizer-events";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";

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

async function account(name: string) {
  const installation = await registerTestAccount(db, name, now);
  return { installation, login: installation.login, proof: installation.proof };
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
    const created = await createOrganizerEvent(db, input, now);
    expect(created.status).toBe("created");
    if (created.status !== "created") throw new Error("Skapandet misslyckades");
    const replay = await createOrganizerEvent(db, input, now);
    expect(replay).toMatchObject({ status: "created", response: {
      eventId: created.response.eventId, raceId: created.response.raceId, replayed: true
    } });
    expect(await createOrganizerEvent(db,
      createInput(owner.proof, key, "Annat namn"), now)).toEqual({ status: "conflict" });
    expect(await createOrganizerEvent(db,
      createInput(other.proof, key, "Syntetisk skogstävling"), now)).toEqual({ status: "conflict" });
    const simultaneous = createInput(owner.proof, randomUUID(), "Samtidigt skapat lopp");
    const competing = await Promise.all([
      createOrganizerEvent(db, simultaneous, now),
      createOrganizerEvent(db, simultaneous, now)
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
      email: owner.installation.email, password: owner.installation.password
    }, { now: new Date(now.getTime() + 1000) });
    if (ownerAgain.status !== "authenticated") throw new Error("Återinloggning misslyckades");
    const listed = await listMyEvents(db, { sessionToken: ownerAgain.sessionToken },
      new Date(now.getTime() + 2000));
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") throw new Error("Ägarlistan saknas efter ny inloggning");
    expect(listed.response.events.map(event => event.eventId)).toContain(created.response.eventId);
    expect(listed.response.events.find(event => event.eventId === created.response.eventId)?.races
      .map(race => race.raceId)).toContain(created.response.raceId);
    expect(await listMyEvents(db, other.proof, now)).toMatchObject({ status: "ok", response: { events: [] } });
    expect(await accountOnRace(db, { ...other.proof, raceId: created.response.raceId }, now))
      .toEqual({ status: "unauthorized" });
  });

  it("kontots session gäller tävlingen med ägarens roll och slutar gälla vid utloggning", async () => {
    const owner = await account(`admin.${randomUUID().slice(0, 8)}`);
    const created = await createOrganizerEvent(db, createInput(owner.proof, randomUUID(), "Sessionstest"), now);
    if (created.status !== "created") throw new Error("Skapandet misslyckades");
    const raceId = created.response.raceId;
    const raceProof = { ...owner.proof, raceId };
    expect(await requireRaceRole(db, { ...raceProof, role: "ADMIN", requireCsrf: true }, now)).toMatchObject({
      status: "authenticated", principal: { accountId: owner.installation.accountId, grantRole: "OWNER", role: "ADMIN" } });
    expect((await db.transaction(tx => requireRaceRole(tx, { ...raceProof, role: "ADMIN" }, now, "share"))).status)
      .toBe("authenticated");
    const classRequest = { formatVersion: 1 as const, requestId: randomUUID(), courseName: "Syntetisk bana", className: "H21", startRule: "PUNCH" as const, controlCodes: [31] };
    const classCreated = await createManualCourseClassAsAdmin(db, {
      ...raceProof, idempotencyKey: `manual-course-class-create:${classRequest.requestId}`, request: classRequest
    }, now);
    expect(classCreated.status).toBe("created");
    expect((await logoutUserAccountSession(db, owner.proof, new Date(now.getTime() + 2000))).status).toBe("logged-out");
    expect((await requireRaceRole(db, { ...raceProof, role: "ADMIN" }, new Date(now.getTime() + 3000))).status)
      .toBe("unauthorized");
    expect((await db.transaction(tx => requireRaceRole(tx, { ...raceProof, role: "ADMIN" },
      new Date(now.getTime() + 3000), "share"))).status).toBe("unauthorized");
    const rejectedRequest = { ...classRequest, requestId: randomUUID() };
    expect((await createManualCourseClassAsAdmin(db, {
      ...raceProof, idempotencyKey: `manual-course-class-create:${rejectedRequest.requestId}`, request: rejectedRequest
    }, new Date(now.getTime() + 3000))).status).toBe("unauthorized");
  });

  it("spärrar tävlingen vid borttagen behörighet och lösenordsbyte", async () => {
    const owner = await account(`rotate.${randomUUID().slice(0, 8)}`);
    const created = await createOrganizerEvent(db, createInput(owner.proof, randomUUID(), "Granttest"), now);
    if (created.status !== "created") throw new Error("Skapandet misslyckades");
    const entered = await accountOnRace(db, { ...owner.proof, raceId: created.response.raceId }, now);
    if (entered.status !== "authenticated") throw new Error("Delegeringen misslyckades");
    const raceProof = { raceId: created.response.raceId, sessionToken: entered.sessionToken };
    const rotated = await changeAccountPassword(db, owner.proof, { formatVersion: 1,
      currentPassword: owner.installation.password, newPassword: "nytt-hemligt-lösen" }, new Date(now.getTime() + 2000));
    expect(rotated.status).toBe("authenticated");
    expect((await listMyEvents(db, owner.proof, new Date(now.getTime() + 3000))).status).toBe("unauthorized");
    expect((await requireRaceRole(db, { ...raceProof, role: "ADMIN" }, new Date(now.getTime() + 3000))).status)
      .toBe("unauthorized");
    const relogin = await loginUserAccount(db, { formatVersion: 1, email: owner.installation.email,
      password: "nytt-hemligt-lösen" }, { now: new Date(now.getTime() + 4000) });
    expect(relogin.status).toBe("authenticated");
    if (relogin.status !== "authenticated") return;
    const newProof = { sessionToken: relogin.sessionToken, csrfCookie: relogin.csrfToken, csrfHeader: relogin.csrfToken };
    const newEntry = await accountOnRace(db, { ...newProof, raceId: created.response.raceId },
      new Date(now.getTime() + 5000));
    if (newEntry.status !== "authenticated") throw new Error("Ny delegering misslyckades");
    const [grant] = await db.select({ id: schema.eventAdministrationGrants.id }).from(schema.eventAdministrationGrants)
      .where(eq(schema.eventAdministrationGrants.eventId, created.response.eventId));
    if (!grant) throw new Error("Ägargranten saknas");
    await db.insert(schema.eventAdministrationGrantRevocations).values({
      grantId: grant.id, revokedAt: new Date(now.getTime() + 6000), reason: "TEST_REVOKED"
    });
    expect((await requireRaceRole(db, { raceId: created.response.raceId, role: "ADMIN", sessionToken: newEntry.sessionToken },
      new Date(now.getTime() + 7000))).status).toBe("unauthorized");
    expect(await listMyEvents(db, newProof, new Date(now.getTime() + 7000)))
      .toMatchObject({ status: "ok", response: { events: [] } });
  });

  it("avvisar både kontoläsning och tävlingens adminförfrågningar efter kontospärr", async () => {
    const owner = await account(`blocked.${randomUUID().slice(0, 8)}`);
    const created = await createOrganizerEvent(db, createInput(owner.proof, randomUUID(), "Kontospärrstest"), now);
    if (created.status !== "created") throw new Error("Skapandet misslyckades");
    const entered = await accountOnRace(db, { ...owner.proof, raceId: created.response.raceId }, now);
    if (entered.status !== "authenticated") throw new Error("Delegeringen misslyckades");
    await db.update(schema.userAccounts).set({ blockedAt: new Date(now.getTime() + 1000) })
      .where(eq(schema.userAccounts.id, owner.installation.accountId));
    expect((await listMyEvents(db, owner.proof, new Date(now.getTime() + 2000))).status)
      .toBe("unauthorized");
    expect((await requireRaceRole(db, { sessionToken: entered.sessionToken, raceId: created.response.raceId, role: "ADMIN" },
      new Date(now.getTime() + 2000))).status).toBe("unauthorized");
  });

  it("begränsar felaktig inloggning beständigt, även när rätt lösenord senare anges", async () => {
    const installation = await registerTestAccount(db, `throttle.${randomUUID().slice(0, 8)}`, now);
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await loginUserAccount(db, { formatVersion: 1, email: installation.email,
        password: "felaktigt lösenord" }, { now: new Date(now.getTime() + attempt * 1000) })).status)
        .toBe("unauthorized");
    }
    expect((await loginUserAccount(db, { formatVersion: 1, email: installation.email,
      password: installation.password }, { now: new Date(now.getTime() + 5000) })).status)
      .toBe("rate-limited");
    expect((await loginUserAccount(db, { formatVersion: 1, email: installation.email.toUpperCase(),
      password: installation.password }, { now: new Date(now.getTime() + 16 * 60 * 1000) })).status)
      .toBe("authenticated");
  });

  it("listMyEvents batchar flera event/roller, hedrar e-postbekräftelse och väntar ut samtidig återkallelse (FOR SHARE / MVCC)", async () => {
    const owner = await account(`batch-owner.${randomUUID().slice(0, 8)}`);
    const helper = await account(`batch-helper.${randomUUID().slice(0, 8)}`);
    const ev1 = await createOrganizerEvent(db, createInput(owner.proof, randomUUID(), "Batch-event 1"), now);
    const ev2 = await createOrganizerEvent(db, createInput(owner.proof, randomUUID(), "Batch-event 2"), now);
    const ev3 = await createOrganizerEvent(db, createInput(owner.proof, randomUUID(), "Batch-event 3"), now);
    if (ev1.status !== "created" || ev2.status !== "created" || ev3.status !== "created") throw new Error("Skapande misslyckades");

    // Ge helper både FUNCTIONARY och ADMIN på ev1 (ADMIN vinner), ADMIN på ev2 (återkallas), FUNCTIONARY på ev3.
    const [g1Func] = await db.insert(schema.eventAdministrationGrants).values({
      eventId: ev1.response.eventId, accountId: helper.installation.accountId, role: "FUNCTIONARY",
      grantedAt: new Date(now.getTime() + 1_000)
    }).returning({ id: schema.eventAdministrationGrants.id });
    await db.insert(schema.eventAdministrationGrants).values({
      eventId: ev1.response.eventId, accountId: helper.installation.accountId, role: "ADMIN",
      grantedAt: new Date(now.getTime() + 2_000)
    });
    const [g2Admin] = await db.insert(schema.eventAdministrationGrants).values({
      eventId: ev2.response.eventId, accountId: helper.installation.accountId, role: "ADMIN",
      grantedAt: new Date(now.getTime() + 3_000)
    }).returning({ id: schema.eventAdministrationGrants.id });
    const [g3Func] = await db.insert(schema.eventAdministrationGrants).values({
      eventId: ev3.response.eventId, accountId: helper.installation.accountId, role: "FUNCTIONARY",
      grantedAt: new Date(now.getTime() + 4_000)
    }).returning({ id: schema.eventAdministrationGrants.id });
    expect(g1Func && g2Admin && g3Func).toBeTruthy();

    // Återkalla ev2 direkt och verifiera exakt ordning & uppgraderad roll för ev1 + ev3.
    await db.insert(schema.eventAdministrationGrantRevocations).values({
      grantId: g2Admin!.id, revokedAt: new Date(now.getTime() + 5_000), reason: "TEST_BATCH_REVOKE"
    });
    const beforeMvcc = await listMyEvents(db, helper.proof, new Date(now.getTime() + 6_000));
    expect(beforeMvcc.status).toBe("ok");
    if (beforeMvcc.status !== "ok") throw new Error("listMyEvents misslyckades");
    expect(beforeMvcc.response.events.map(e => ({ eventId: e.eventId, role: e.role }))).toEqual([
      { eventId: ev1.response.eventId, role: "ADMIN" },
      { eventId: ev3.response.eventId, role: "FUNCTIONARY" }
    ]);

    // Pågående ocommittad återkallelse av ev3 håller radlås på event_administration_grant_guard via trigger:
    // listMyEvents (FOR SHARE) måste vänta tills återkallelsen committar och sedan utesluta ev3.
    const revoker = await pool.connect();
    try {
      await revoker.query("BEGIN");
      await revoker.query(
        "INSERT INTO event_administration_grant_revocation (grant_id, revoked_at, reason) VALUES ($1, $2, $3)",
        [g3Func!.id, new Date(now.getTime() + 7_000).toISOString(), "CONCURRENT_MVCC_REVOKE"]
      );
      const pending = listMyEvents(db, helper.proof, new Date(now.getTime() + 8_000));
      const race = await Promise.race([
        pending.then(() => "klart" as const),
        new Promise<"väntar">((resolve) => setTimeout(() => resolve("väntar"), 250))
      ]);
      expect(race).toBe("väntar");
      await revoker.query("COMMIT");
      const afterMvcc = await pending;
      expect(afterMvcc.status).toBe("ok");
      if (afterMvcc.status !== "ok") throw new Error("listMyEvents efter commit misslyckades");
      expect(afterMvcc.response.events.map(e => ({ eventId: e.eventId, role: e.role }))).toEqual([
        { eventId: ev1.response.eventId, role: "ADMIN" }
      ]);
    } finally {
      await revoker.query("ROLLBACK").catch(() => undefined);
      revoker.release();
    }

    // Obekräftad e-post: behåller bara OWNER-event, inte ADMIN/FUNCTIONARY.
    const helperOwn = await createOrganizerEvent(db, createInput(helper.proof, randomUUID(), "Helpers eget"), new Date(now.getTime() + 9_000));
    if (helperOwn.status !== "created") throw new Error("Eget event misslyckades");
    await db.update(schema.userAccounts).set({ emailVerifiedAt: null }).where(eq(schema.userAccounts.id, helper.installation.accountId));
    const unverified = await listMyEvents(db, helper.proof, new Date(now.getTime() + 10_000));
    expect(unverified.status).toBe("ok");
    if (unverified.status !== "ok") throw new Error("listMyEvents för obekräftat konto misslyckades");
    expect(unverified.response.events.map(e => ({ eventId: e.eventId, role: e.role }))).toEqual([
      { eventId: helperOwn.response.eventId, role: "OWNER" }
    ]);
  });
});
