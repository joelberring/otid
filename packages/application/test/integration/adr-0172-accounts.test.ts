import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { authenticateUserAccountSession, loginUserAccount, registerUserAccount } from "../../src/user-account";
import { completePasswordReset, requestPasswordReset } from "../../src/password-reset";
import { deleteOwnAccount, readAccountProfile } from "../../src/account-self-service";
import { createOrganizerEvent, listMyEvents } from "../../src/organizer-events";
import { performSuperadminAction, readSuperadminOverview, setSuperadmin } from "../../src/superadmin";
import { isRacePubliclyVisible } from "../../src/public-race-visibility";
import { listPublicRaces } from "../../src/public-races";
import { createClub } from "../../src/clubs";
import { createTrainingGroup } from "../../src/training-groups";
import { grantRacePerson, registerTestAccount, setRacePublished, TEST_PASSWORD, accountOnRace } from "./accounts";

/**
 * ADR-0172 beslut 1–2 / PLAN.md steg 17: konton med e-post, spärr mot upprepade försök, glömt lösenord,
 * superadmin (spärra, dölja, ta bort, återställningslänk) med logg och borttagning av eget konto.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Kontotestet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0172_accounts_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0172_accounts_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const suffix = () => randomUUID().slice(0, 8);
const HOUR = 60 * 60 * 1000;

async function createEvent(proof: { sessionToken: string; csrfCookie: string; csrfHeader: string }, eventName: string) {
  const created = await createOrganizerEvent(db, { ...proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName, raceName: "Torsdag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error(`Tävlingen kunde inte skapas: ${created.status}`);
  return created.response;
}

async function superadmin() {
  const account = await registerTestAccount(db, `super.${suffix()}`);
  expect(await setSuperadmin(db, { email: account.email.toUpperCase(), superadmin: true })).toMatchObject({ status: "changed" });
  const login = await loginUserAccount(db, { formatVersion: 1, email: account.email, password: account.password });
  if (login.status !== "authenticated") throw new Error("Superadmin kunde inte logga in");
  expect(login.response.superadmin).toBe(true);
  return { ...account, proof: { sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken } };
}

describe("ADR-0172 konton", () => {
  it("registrerar med e-post utan hänsyn till versaler och loggar in med adressen", async () => {
    const name = `anna.${suffix()}`;
    const registered = await registerUserAccount(db, { formatVersion: 1, email: `  ${name.toUpperCase()}@Klubb.SE `,
      displayName: "Anna Arrangör", password: "hemligt-lösen" });
    if (registered.status !== "authenticated") throw new Error("Registreringen misslyckades");
    expect(registered.response).toMatchObject({ email: `${name}@klubb.se`, displayName: "Anna Arrangör", superadmin: false });
    const [stored] = await db.select().from(schema.userAccounts).where(eq(schema.userAccounts.id, registered.response.accountId));
    expect(stored?.email).toBe(`${name}@klubb.se`);
    expect(stored?.lastLoginAt).not.toBeNull();

    expect(await registerUserAccount(db, { formatVersion: 1, email: `${name}@KLUBB.se`, displayName: "Dubblett", password: "annat-lösen" }))
      .toEqual({ status: "conflict" });
    expect(await registerUserAccount(db, { formatVersion: 1, email: "inte-en-adress", displayName: "X", password: "hemligt-lösen" }))
      .toEqual({ status: "invalid-request" });
    expect(await registerUserAccount(db, { formatVersion: 1, email: `kort.${suffix()}@klubb.se`, displayName: "X", password: "kort" }))
      .toEqual({ status: "invalid-request" });

    expect((await loginUserAccount(db, { formatVersion: 1, email: `${name.toUpperCase()}@klubb.se`, password: "hemligt-lösen" })).status)
      .toBe("authenticated");
    expect((await loginUserAccount(db, { formatVersion: 1, email: `${name}@klubb.se`, password: "fel-lösen" })).status)
      .toBe("unauthorized");
    expect((await loginUserAccount(db, { formatVersion: 1, email: `okand.${suffix()}@klubb.se`, password: "hemligt-lösen" })).status)
      .toBe("unauthorized");
  });

  it("spärrar registrering efter för många försök från samma adress inom en timme", async () => {
    const now = new Date("2026-10-05T10:00:00Z");
    const ip = `203.0.113.${Math.floor(Math.random() * 200)}-${suffix()}`;
    const attempt = (at: Date, clientKey = ip) => registerUserAccount(db, { formatVersion: 1, email: `spam.${suffix()}@exempel.se`,
      displayName: "Spam", password: "hemligt-lösen" }, { now: at, clientKey, registrationsPerHour: 3 });
    for (let index = 0; index < 3; index++) expect((await attempt(new Date(now.getTime() + index * 1000))).status).toBe("authenticated");
    expect((await attempt(new Date(now.getTime() + 5000))).status).toBe("rate-limited");
    expect((await attempt(new Date(now.getTime() + 6000), `${ip}-annan`)).status).toBe("authenticated");
    expect((await attempt(new Date(now.getTime() + HOUR + 1000))).status).toBe("authenticated");
    const stored = await pool.query<{ key_hash: string }>("select key_hash from account_request_throttle where scope = 'REGISTER_IP'");
    expect(JSON.stringify(stored.rows)).not.toContain(ip);
  });

  it("återställer lösenordet med en engångslänk som gäller en timme och spärrar alla sessioner", async () => {
    const account = await registerTestAccount(db, `glomsk.${suffix()}`);
    const other = await loginUserAccount(db, { formatVersion: 1, email: account.email, password: account.password });
    if (other.status !== "authenticated") throw new Error("Andra inloggningen misslyckades");

    // Samma svar oavsett om adressen finns; bara ett befintligt konto får något att skicka.
    const unknown = await requestPasswordReset(db, { formatVersion: 1, email: `okand.${suffix()}@test.o-tid.se` });
    expect(unknown).toEqual({ status: "accepted" });
    const known = await requestPasswordReset(db, { formatVersion: 1, email: account.email.toUpperCase() });
    if (known.status !== "accepted" || !known.delivery) throw new Error("Länken saknas");
    expect(known.delivery.email).toBe(account.email);
    const stored = await pool.query<{ token_hash: string }>("select token_hash from password_reset_token where account_id = $1", [account.accountId]);
    expect(JSON.stringify(stored.rows)).not.toContain(known.delivery.token);

    expect(await completePasswordReset(db, { formatVersion: 1, token: known.delivery.token, password: "kort" }))
      .toEqual({ status: "invalid-request" });
    // ADR-0205: länken loggar in på enheten där den öppnades.
    expect(await completePasswordReset(db, { formatVersion: 1, token: known.delivery.token, password: "nytt-lösenord-1" }))
      .toMatchObject({ status: "authenticated", response: { email: account.email } });
    expect(await completePasswordReset(db, { formatVersion: 1, token: known.delivery.token, password: "nytt-lösenord-2" }))
      .toEqual({ status: "invalid-token" });
    expect((await authenticateUserAccountSession(db, account.proof)).status).toBe("unauthorized");
    expect((await authenticateUserAccountSession(db, { sessionToken: other.sessionToken })).status).toBe("unauthorized");
    expect((await loginUserAccount(db, { formatVersion: 1, email: account.email, password: account.password })).status).toBe("unauthorized");
    expect((await loginUserAccount(db, { formatVersion: 1, email: account.email, password: "nytt-lösenord-1" })).status).toBe("authenticated");

    // En timme gammal länk gäller inte.
    const created = new Date(Date.now() + 1000);
    const late = await requestPasswordReset(db, { formatVersion: 1, email: account.email }, { now: created });
    if (late.status !== "accepted" || !late.delivery) throw new Error("Länken saknas");
    expect(await completePasswordReset(db, { formatVersion: 1, token: late.delivery.token, password: "nytt-lösenord-3" },
      { now: new Date(created.getTime() + HOUR + 1) })).toEqual({ status: "invalid-token" });

    // Högst tre länkar per adress och timme; svaret är detsamma.
    const again = await requestPasswordReset(db, { formatVersion: 1, email: account.email }, { now: created });
    expect(again.status === "accepted" && again.delivery).toBeTruthy();
    expect(await requestPasswordReset(db, { formatVersion: 1, email: account.email }, { now: created })).toEqual({ status: "accepted" });
  });

  it("ger superadmin med serverkommandot och nekar alla andra superadminsidan", async () => {
    const ordinary = await registerTestAccount(db, `vanlig.${suffix()}`);
    expect(await readSuperadminOverview(db, ordinary.proof, {})).toEqual({ status: "forbidden" });
    expect(await performSuperadminAction(db, ordinary.proof, { formatVersion: 1, action: "BLOCK_ACCOUNT",
      accountId: ordinary.accountId, reason: "Test" })).toEqual({ status: "forbidden" });
    expect(await setSuperadmin(db, { email: `saknas.${suffix()}@test.o-tid.se`, superadmin: true })).toEqual({ status: "not-found" });

    const boss = await superadmin();
    const overview = await readSuperadminOverview(db, boss.proof, { accounts: ordinary.email.slice(0, 12).toUpperCase() });
    if (overview.status !== "ok") throw new Error("Översikten saknas");
    expect(overview.response.accounts.map((row) => row.email)).toEqual([ordinary.email]);
    // Användartest 2026-11-12: listan visar om adressen är obekräftad.
    expect(overview.response.accounts[0]?.emailVerified).toBe(true);
    await db.update(schema.userAccounts).set({ emailVerifiedAt: null }).where(eq(schema.userAccounts.id, ordinary.accountId));
    const unverified = await readSuperadminOverview(db, boss.proof, { accounts: ordinary.email });
    if (unverified.status !== "ok") throw new Error("Översikten saknas");
    expect(unverified.response.accounts[0]?.emailVerified).toBe(false);
    expect(overview.response.log[0]).toMatchObject({ action: "GRANT_SUPERADMIN", actorLabel: "Serverkommando", targetLabel: boss.email });
    expect(await setSuperadmin(db, { email: boss.email, superadmin: true })).toMatchObject({ status: "unchanged" });
  });

  it("spärrar och släpper ett konto: inloggning nekas och alla sessioner spärras", async () => {
    const boss = await superadmin();
    const spam = await registerTestAccount(db, `spam.${suffix()}`);
    const event = await createEvent(spam.proof, "Skräptävling");
    const entered = await accountOnRace(db, { ...spam.proof, raceId: event.raceId });
    expect(entered.status).toBe("authenticated");

    expect(await performSuperadminAction(db, boss.proof, { formatVersion: 1, action: "BLOCK_ACCOUNT", accountId: boss.accountId,
      reason: "Fel konto" })).toEqual({ status: "invalid-request" });
    expect(await performSuperadminAction(db, boss.proof, { formatVersion: 1, action: "BLOCK_ACCOUNT", accountId: spam.accountId,
      reason: "Skräpkonto" })).toEqual({ status: "done", action: "BLOCK_ACCOUNT" });
    expect((await authenticateUserAccountSession(db, spam.proof)).status).toBe("unauthorized");
    expect((await listMyEvents(db, spam.proof)).status).toBe("unauthorized");
    expect((await loginUserAccount(db, { formatVersion: 1, email: spam.email, password: spam.password })).status).toBe("blocked");
    expect((await loginUserAccount(db, { formatVersion: 1, email: spam.email, password: "fel-lösen" })).status).toBe("unauthorized");
    expect(await requestPasswordReset(db, { formatVersion: 1, email: spam.email })).toEqual({ status: "accepted" });

    expect(await performSuperadminAction(db, boss.proof, { formatVersion: 1, action: "UNBLOCK_ACCOUNT", accountId: spam.accountId,
      reason: "Misstag" })).toEqual({ status: "done", action: "UNBLOCK_ACCOUNT" });
    expect((await authenticateUserAccountSession(db, spam.proof)).status).toBe("unauthorized");
    expect((await loginUserAccount(db, { formatVersion: 1, email: spam.email, password: spam.password })).status).toBe("authenticated");
  });

  it("döljer en tävling från de publika sidorna och visar den igen", async () => {
    const boss = await superadmin();
    const owner = await registerTestAccount(db, `dold.${suffix()}`);
    const event = await createEvent(owner.proof, `Dold ${suffix()}`);
    expect(await setRacePublished(db, owner.proof, event.raceId)).toMatchObject({ status: "saved" });
    expect(await isRacePubliclyVisible(db, event.raceId)).toBe(true);
    expect(await performSuperadminAction(db, boss.proof, { formatVersion: 1, action: "HIDE_RACE", raceId: event.raceId,
      reason: "Stötande namn" })).toEqual({ status: "done", action: "HIDE_RACE" });
    expect(await isRacePubliclyVisible(db, event.raceId)).toBe(false);
    const listing = await listPublicRaces(db, { recentLimit: 200 });
    expect([...listing.ongoing, ...listing.upcoming, ...listing.recent].map((row) => row.raceId)).not.toContain(event.raceId);
    // Ägaren ser fortfarande sin tävling.
    const mine = await listMyEvents(db, owner.proof);
    expect(mine.status === "ok" && mine.response.events.map((row) => row.eventId)).toContain(event.eventId);
    expect(await performSuperadminAction(db, boss.proof, { formatVersion: 1, action: "UNHIDE_RACE", raceId: event.raceId,
      reason: "Namnet är bytt" })).toEqual({ status: "done", action: "UNHIDE_RACE" });
    expect(await isRacePubliclyVisible(db, event.raceId)).toBe(true);
    expect(await isRacePubliclyVisible(db, randomUUID())).toBe(false);
  });

  it("tar bort ett konto tillsammans med tävlingarna det äger men lämnar andras tävlingar", async () => {
    const owner = await registerTestAccount(db, `agare.${suffix()}`);
    const leaving = await registerTestAccount(db, `lamnar.${suffix()}`);
    const own = await createEvent(leaving.proof, "Egen träning");
    const shared = await createEvent(owner.proof, "Klubbens tävling");
    expect((await grantRacePerson(db, owner.proof, shared.raceId, leaving.email, "ADMIN")).status).toBe("granted");
    expect((await accountOnRace(db, { ...leaving.proof, raceId: shared.raceId })).status).toBe("authenticated");

    const profile = await readAccountProfile(db, leaving.proof);
    expect(profile.status === "ok" && profile.response.ownedEvents.map((event) => event.eventName)).toEqual(["Egen träning"]);
    expect(await deleteOwnAccount(db, leaving.proof, { formatVersion: 1, password: "fel-lösen" })).toEqual({ status: "wrong-password" });
    expect(await deleteOwnAccount(db, leaving.proof, { formatVersion: 1, password: TEST_PASSWORD })).toEqual({ status: "deleted" });

    expect(await db.select().from(schema.userAccounts).where(eq(schema.userAccounts.id, leaving.accountId))).toEqual([]);
    expect(await db.select().from(schema.events).where(eq(schema.events.id, own.eventId))).toEqual([]);
    expect(await db.select().from(schema.races).where(eq(schema.races.id, shared.raceId))).toHaveLength(1);
    const grants = await db.select().from(schema.eventAdministrationGrants).where(eq(schema.eventAdministrationGrants.eventId, shared.eventId));
    expect(grants.map((grant) => grant.accountId)).toEqual([owner.accountId]);
    expect((await accountOnRace(db, { ...owner.proof, raceId: shared.raceId })).status).toBe("authenticated");
    // Adressen är ledig igen.
    expect((await registerUserAccount(db, { formatVersion: 1, email: leaving.email, displayName: "Ny", password: "hemligt-lösen" })).status)
      .toBe("authenticated");
  });

  it("ändrat 2026-11-07: vägrar ta bort kontot när det är ensam ägare av en klubb eller ensam ledare av en träningsgrupp", async () => {
    const leaving = await registerTestAccount(db, `ensam.${suffix()}`);
    const other = await registerTestAccount(db, `annan.${suffix()}`);
    const club = await createClub(db, { ...leaving.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "OK Ensam" } });
    if (club.status !== "created") throw new Error(club.status);
    const group = await createTrainingGroup(db, { ...leaving.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "Ungdomsgruppen",
      code: `ensam-${suffix()}` } });
    if (group.status !== "created") throw new Error(group.status);
    // Den andra är vanlig medlem i båda: de skulle bli utan ägare och ledare.
    await pool.query("insert into club_member (id, club_id, account_id, role, added_at, added_by, request_id) values ($1, $2, $3, 'READER', now(), $4, $5)",
      [randomUUID(), club.club.clubId, other.accountId, leaving.accountId, randomUUID()]);
    await pool.query(`insert into training_group_member (id, group_id, account_id, role, added_at, added_by, request_id)
      values ($1, $2, $3, 'MEMBER', now(), $4, $5)`, [randomUUID(), group.group.groupId, other.accountId, leaving.accountId, randomUUID()]);

    const profile = await readAccountProfile(db, leaving.proof);
    expect(profile.status === "ok" && profile.response.soleOwnerOf).toEqual([
      { kind: "CLUB", id: club.club.clubId, name: "OK Ensam" }, { kind: "TRAINING_GROUP", id: group.group.groupId, name: "Ungdomsgruppen" }]);
    expect(await deleteOwnAccount(db, leaving.proof, { formatVersion: 1, password: "fel-lösen" })).toEqual({ status: "wrong-password" });
    expect(await deleteOwnAccount(db, leaving.proof, { formatVersion: 1, password: TEST_PASSWORD })).toMatchObject({ status: "sole-owner",
      soleOwnerOf: [{ kind: "CLUB", name: "OK Ensam" }, { kind: "TRAINING_GROUP", name: "Ungdomsgruppen" }] });
    expect(await db.select().from(schema.userAccounts).where(eq(schema.userAccounts.id, leaving.accountId))).toHaveLength(1);
    expect((await pool.query("select 1 from club_member where club_id = $1 and account_id = $2", [club.club.clubId, leaving.accountId])).rowCount).toBe(1);

    // Ägarskapet överlämnat (en ägare till och en ledare till): kontot går att ta bort, och klubben och gruppen har kvar sin ägare och ledare.
    await pool.query("update club_member set role = 'OWNER' where club_id = $1 and account_id = $2", [club.club.clubId, other.accountId]);
    await pool.query("update training_group_member set role = 'LEADER' where group_id = $1 and account_id = $2", [group.group.groupId, other.accountId]);
    const after = await readAccountProfile(db, leaving.proof);
    expect(after.status === "ok" && after.response.soleOwnerOf).toEqual([]);
    expect(await deleteOwnAccount(db, leaving.proof, { formatVersion: 1, password: TEST_PASSWORD })).toEqual({ status: "deleted" });
    expect((await pool.query("select role from club_member where club_id = $1", [club.club.clubId])).rows).toEqual([{ role: "OWNER" }]);
    expect((await pool.query("select role from training_group_member where group_id = $1", [group.group.groupId])).rows).toEqual([{ role: "LEADER" }]);
  });

  it("superadmin tar bort konto och tävling efter bekräftelse, skapar återställningslänk och loggar allt", async () => {
    const boss = await superadmin();
    const spam = await registerTestAccount(db, `skrap.${suffix()}`);
    const spamEvent = await createEvent(spam.proof, "Gratis klockor");
    const other = await registerTestAccount(db, `annan.${suffix()}`);
    const otherEvent = await createEvent(other.proof, "Riktig träning");

    expect(await performSuperadminAction(db, boss.proof, { formatVersion: 1, action: "DELETE_EVENT", eventId: otherEvent.eventId,
      reason: "Fel", confirmation: "Gratis klockor" })).toEqual({ status: "confirmation-mismatch" });
    expect(await performSuperadminAction(db, boss.proof, { formatVersion: 1, action: "DELETE_EVENT", eventId: spamEvent.eventId,
      reason: "Reklam", confirmation: " Gratis klockor " })).toEqual({ status: "done", action: "DELETE_EVENT" });
    expect(await db.select().from(schema.races).where(eq(schema.races.id, spamEvent.raceId))).toEqual([]);
    expect(await db.select().from(schema.races).where(eq(schema.races.id, otherEvent.raceId))).toHaveLength(1);

    const link = await performSuperadminAction(db, boss.proof, { formatVersion: 1, action: "CREATE_RESET_LINK", accountId: other.accountId,
      reason: "Ringde och bad om hjälp" });
    if (link.status !== "done" || !link.reset) throw new Error("Länken saknas");
    expect(await completePasswordReset(db, { formatVersion: 1, token: link.reset.token, password: "nytt-lösenord-1" }))
      .toMatchObject({ status: "authenticated" });

    expect(await performSuperadminAction(db, boss.proof, { formatVersion: 1, action: "DELETE_ACCOUNT", accountId: spam.accountId,
      reason: "Skräp", confirmation: "fel@exempel.se" })).toEqual({ status: "confirmation-mismatch" });
    expect(await performSuperadminAction(db, boss.proof, { formatVersion: 1, action: "DELETE_ACCOUNT", accountId: spam.accountId,
      reason: "Skräp", confirmation: spam.email.toUpperCase() })).toEqual({ status: "done", action: "DELETE_ACCOUNT" });
    expect(await db.select().from(schema.userAccounts).where(eq(schema.userAccounts.id, spam.accountId))).toEqual([]);

    const overview = await readSuperadminOverview(db, boss.proof, {});
    if (overview.status !== "ok") throw new Error("Översikten saknas");
    expect(overview.response.accounts.find((row) => row.email === other.email)).toMatchObject({ eventCount: 1, blocked: false });
    expect(overview.response.races.find((row) => row.raceId === otherEvent.raceId)).toMatchObject({ ownerEmail: other.email, hidden: false });
    const mine = overview.response.log.filter((entry) => entry.actorLabel === boss.email);
    expect(mine.map((entry) => [entry.action, entry.targetLabel, entry.reason])).toEqual([
      ["DELETE_ACCOUNT", spam.email, "Skräp"],
      ["CREATE_RESET_LINK", other.email, "Ringde och bad om hjälp"],
      ["DELETE_EVENT", "Gratis klockor", "Reklam"]
    ]);
    await expect(pool.query("update superadmin_action set reason = 'ändrad'")).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from superadmin_action")).rejects.toThrow(/append-only/);
  });
});
