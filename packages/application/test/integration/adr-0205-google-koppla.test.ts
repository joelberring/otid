import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { authenticateUserAccountSession, loginUserAccount, logoutAllUserAccountSessions, SHORT_SESSION_LIFETIME_MS, SESSION_LIFETIME_MS }
  from "../../src/user-account";
import { signInWithGoogle } from "../../src/google-login";
import {
  deleteAccountConfirmedWithGoogle, GOOGLE_DELETE_MAX_AGE_MS, linkGoogleToAccount, moveGoogleLinkByCommand, moveGoogleLinkToAccount, parseGoogleMovePending, readGoogleMove, serializeGoogleMovePending,
  unlinkGoogleFromAccount, GOOGLE_MOVE_RECENT_LOGIN_MS, type GoogleMovePending
} from "../../src/google-link";
import { readAccountProfile, changeAccountPassword } from "../../src/account-self-service";
import { answerAccountClubStep } from "../../src/club-affiliations";
import { completePasswordReset, requestPasswordReset } from "../../src/password-reset";
import { createOrganizerEvent } from "../../src/organizer-events";
import { grantRacePersonAsAdmin } from "../../src/race-people";
import { registerTestAccount, TEST_PASSWORD } from "./accounts";
import { createTrainingGroup } from "../../src/training-groups";
import { startFakeGoogle, type FakeGoogle } from "./fake-google";

/**
 * ADR-0205 tillägg: ägarens fall i drift. Kontot har joel@…; Google-kontot har en annan Gmail-adress, och inloggningen med Google
 * skapade ett andra konto. Koppla Google-konto under Mitt konto (också med en annan adress), flytta kopplingen från den tomma
 * dubbletten, vägra när den används, Ta bort kopplingen, bindningen till sessionen, superadmins kommando, Kom ihåg mig och
 * Logga ut från alla enheter. Mot den falska OpenID-leverantören från ADR-0205.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("ADR-0205-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0205k_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

let provider: FakeGoogle;
beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
  provider = await startFakeGoogle();
}, 120_000);
afterAll(async () => {
  await provider.close();
  await pool.end();
  if (!/^otid_adr0205k_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const gmail = () => `joel.${randomUUID().slice(0, 8)}@gmail.com`;
const sub = () => String(Math.floor(Math.random() * 1e15));
const sessionIdOf = (token: string) => token.split(".")[1]!;
type Account = Awaited<ReturnType<typeof registerTestAccount>>;
const linkAs = async (account: Account, claims: Record<string, unknown>, boundSessionId = sessionIdOf(account.proof.sessionToken), now?: Date) =>
  linkGoogleToAccount(db, { proof: account.proof, boundSessionId, identity: await provider.identity(claims) }, now);
const googleLogin = async (claims: Record<string, unknown>) => {
  const result = await signInWithGoogle(db, await provider.identity(claims));
  if (result.status !== "authenticated") throw new Error(`Inte inloggad med Google: ${result.status}`);
  return result;
};
const accountExists = async (accountId: string) => (await pool.query("select 1 from user_account where id = $1", [accountId])).rowCount === 1;

/** En inbjudan (funktionär) till adressen från ett annat konto. */
async function invite(address: string) {
  const owner = await registerTestAccount(db);
  const created = await createOrganizerEvent(db, { ...owner.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Klubbträning", raceName: "Tisdag", raceDate: "2026-11-10", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const requestId = randomUUID();
  const granted = await grantRacePersonAsAdmin(db, { ...owner.proof, raceId: created.response.raceId, idempotencyKey: `race-person-grant:${requestId}`,
    readBody: async () => ({ formatVersion: 1, requestId, email: address, role: "FUNCTIONARY" }) });
  expect(granted.status).toBe("granted");
}

describe("ADR-0205 tillägg: Koppla Google-konto", () => {
  it("kopplar ett Google-konto med en annan adress; kontots adress står kvar och Google loggar in på samma konto", async () => {
    const joel = await registerTestAccount(db);
    const google = gmail();
    const id = sub();
    const linked = await linkAs(joel, { sub: id, email: google.toUpperCase(), email_verified: true, name: "Joel" });
    expect(linked).toEqual({ status: "linked", googleEmail: google });
    const profile = await readAccountProfile(db, joel.proof);
    expect(profile).toMatchObject({ status: "ok", response: { email: joel.email, hasPassword: true, google: { email: google } } });
    const signed = await googleLogin({ sub: id, email: google, email_verified: true });
    expect(signed).toMatchObject({ created: false, response: { accountId: joel.accountId, email: joel.email } });
    expect((await pool.query("select 1 from user_account where email = $1", [google])).rowCount).toBe(0);
    // Lösenordet gäller som förut.
    expect((await loginUserAccount(db, { formatVersion: 1, email: joel.email, password: TEST_PASSWORD })).status).toBe("authenticated");
  }, 60_000);

  it("vägrar en adress som Google inte har bekräftat", async () => {
    const joel = await registerTestAccount(db);
    expect(await linkAs(joel, { sub: sub(), email: gmail(), email_verified: false })).toEqual({ status: "email-not-verified" });
    expect(await linkAs(joel, { sub: sub(), email: gmail() })).toEqual({ status: "email-not-verified" });
    expect((await pool.query("select 1 from user_account_google_identity where account_id = $1", [joel.accountId])).rowCount).toBe(0);
  }, 60_000);

  it("kopplingen är bunden till sessionen som började den: en annan session (CSRF eller en annan inloggning) vägras", async () => {
    const joel = await registerTestAccount(db);
    const other = await registerTestAccount(db);
    const id = sub();
    // Angriparen började kopplingen i sin session och lurar Joels webbläsare att slutföra den (eller tvärtom).
    expect(await linkAs(joel, { sub: id, email: gmail(), email_verified: true }, sessionIdOf(other.proof.sessionToken)))
      .toEqual({ status: "session-mismatch" });
    expect(await linkAs({ ...joel, proof: { ...joel.proof, sessionToken: "otid_user_session_v1.x.y" } }, { sub: id, email: gmail(), email_verified: true }))
      .toEqual({ status: "unauthorized" });
    expect((await pool.query("select 1 from user_account_google_identity where google_sub = $1", [id])).rowCount).toBe(0);
    // Den påbörjade flytten är signerad och bunden till sessionen.
    const pending: GoogleMovePending = { sub: id, googleEmail: gmail(), sourceAccountId: other.accountId, sessionId: sessionIdOf(joel.proof.sessionToken),
      expiresAt: Date.now() + 60_000 };
    const value = serializeGoogleMovePending(pending, "hemlighet");
    expect(parseGoogleMovePending(value, new Date(), "hemlighet")).toEqual(pending);
    expect(parseGoogleMovePending(value, new Date(), "en-annan")).toBeUndefined();
    // Byt ett tecken mot ett annat (aldrig samma tecken, annars är värdet oförändrat).
    const flipped = value[10] === "A" ? "B" : "A";
    expect(parseGoogleMovePending(`${value.slice(0, 10)}${flipped}${value.slice(11)}`, new Date(), "hemlighet")).toBeUndefined();
    expect(parseGoogleMovePending(value, new Date(Date.now() + 120_000), "hemlighet")).toBeUndefined();
    expect(await moveGoogleLinkToAccount(db, { proof: other.proof, pending, password: TEST_PASSWORD })).toEqual({ status: "session-mismatch" });
  }, 60_000);

  it("flyttar kopplingen från den tomma dubbletten efter lösenordet; dubbletten tas bort, inbjudningar till Gmail står kvar", async () => {
    const joel = await registerTestAccount(db);
    const google = gmail();
    const id = sub();
    // Ägarens fall: Google-inloggningen skapade ett andra konto med Gmail-adressen.
    const duplicate = await googleLogin({ sub: id, email: google, email_verified: true, name: "Joel Berring" });
    expect(duplicate.created).toBe(true);
    // En inbjudan till Gmail-adressen efter det (den väntar; dubbletten har inte loggat in sedan).
    await invite(google);
    const linked = await linkAs(joel, { sub: id, email: google, email_verified: true });
    if (linked.status !== "move-needed") throw new Error(`Väntade en flytt: ${linked.status}`);
    expect(linked.pending).toMatchObject({ sub: id, googleEmail: google, sourceAccountId: duplicate.response.accountId });
    expect(await readGoogleMove(db, joel.proof, linked.pending)).toMatchObject({ status: "ready",
      details: { googleEmail: google, sourceEmail: google, needsPassword: true } });
    expect(await moveGoogleLinkToAccount(db, { proof: joel.proof, pending: linked.pending, password: "fel-lösen-1" })).toEqual({ status: "wrong-password" });
    expect(await moveGoogleLinkToAccount(db, { proof: joel.proof, pending: linked.pending })).toEqual({ status: "wrong-password" });
    expect(await moveGoogleLinkToAccount(db, { proof: { ...joel.proof, csrfHeader: "A".repeat(43) }, pending: linked.pending, password: TEST_PASSWORD }))
      .toEqual({ status: "forbidden" });
    expect(await moveGoogleLinkToAccount(db, { proof: joel.proof, pending: linked.pending, password: TEST_PASSWORD }))
      .toEqual({ status: "moved", googleEmail: google, sourceEmail: google });
    // Dubbletten är borta och dess session gäller inte; Google loggar in på Joels konto.
    expect(await accountExists(duplicate.response.accountId)).toBe(false);
    expect((await authenticateUserAccountSession(db, { sessionToken: duplicate.sessionToken })).status).toBe("unauthorized");
    expect((await googleLogin({ sub: id, email: google, email_verified: true })).response.accountId).toBe(joel.accountId);
    // Loggen (superadmin) och inbjudan till adressen, som fortfarande väntar.
    const log = await pool.query("select action, actor_label, target_label from superadmin_action where target_id = $1", [duplicate.response.accountId]);
    expect(log.rows).toEqual([{ action: "DELETE_ACCOUNT", actor_label: joel.email, target_label: google }]);
    expect((await pool.query("select accepted_at from race_person_invitation where email = $1", [google])).rows).toEqual([{ accepted_at: null }]);
    // En andra gång finns inget att flytta.
    expect(await moveGoogleLinkToAccount(db, { proof: joel.proof, pending: linked.pending, password: TEST_PASSWORD })).toEqual({ status: "expired" });
  }, 60_000);

  it("ett konto utan känt lösenord bekräftar flytten med en inloggning nyss, annars Logga in igen", async () => {
    // Målkontot skapades med Google (slumpat lösenord); dubbletten med ett annat Google-konto.
    const target = await googleLogin({ sub: sub(), email: gmail(), email_verified: true });
    const id = sub();
    const google = gmail();
    const duplicate = await googleLogin({ sub: id, email: google, email_verified: true });
    const proof = { sessionToken: target.sessionToken, csrfCookie: target.csrfToken, csrfHeader: target.csrfToken };
    const linked = await linkGoogleToAccount(db, { proof, boundSessionId: sessionIdOf(target.sessionToken),
      identity: await provider.identity({ sub: id, email: google, email_verified: true }) });
    if (linked.status !== "move-needed") throw new Error(`Väntade en flytt: ${linked.status}`);
    const later = new Date(Date.now() + GOOGLE_MOVE_RECENT_LOGIN_MS + 60_000);
    expect(await readGoogleMove(db, proof, linked.pending, later)).toMatchObject({ details: { needsPassword: false, recentLogin: false } });
    expect(await moveGoogleLinkToAccount(db, { proof, pending: { ...linked.pending, expiresAt: later.getTime() + 60_000 } }, later))
      .toEqual({ status: "login-again" });
    expect(await moveGoogleLinkToAccount(db, { proof, pending: linked.pending })).toMatchObject({ status: "moved" });
    expect(await accountExists(duplicate.response.accountId)).toBe(false);
  }, 60_000);

  it("vägrar när det andra kontot används (äger en tävling): Logga in på det och ta bort kopplingen där först", async () => {
    const joel = await registerTestAccount(db);
    const id = sub();
    const google = gmail();
    const used = await googleLogin({ sub: id, email: google, email_verified: true });
    const created = await createOrganizerEvent(db, { sessionToken: used.sessionToken, csrfCookie: used.csrfToken, csrfHeader: used.csrfToken,
      idempotencyKey: `organizer-event-create:${randomUUID()}`, readBody: async () => ({ formatVersion: 1, eventName: "Gmail-tävlingen",
        raceName: "", raceDate: "2026-11-20", timeZone: "Europe/Stockholm" }) });
    expect(created.status).toBe("created");
    expect(await linkAs(joel, { sub: id, email: google, email_verified: true })).toEqual({ status: "in-use", googleEmail: google, sourceHasPassword: false });
    expect(await accountExists(used.response.accountId)).toBe(true);
    expect((await googleLogin({ sub: id, email: google, email_verified: true })).response.accountId).toBe(used.response.accountId);
  }, 60_000);

  it("ändrat 2026-11-07: en dubblett som har svarat på Vilken klubb tillhör du? är tom och går att flytta; svaren tas bort", async () => {
    const joel = await registerTestAccount(db);
    const id = sub();
    const google = gmail();
    const duplicate = await googleLogin({ sub: id, email: google, email_verified: true });
    const proof = { sessionToken: duplicate.sessionToken, csrfCookie: duplicate.csrfToken, csrfHeader: duplicate.csrfToken };
    // Ägarens fall: dubbletten fick frågan direkt och svarade (en klubb ur listan och fritext). Inget arkiv har bekräftat.
    const [organisation] = (await pool.query<{ id: string }>(`insert into organisation (id, eventor_id, name, type, search_text, updated_at)
      values ($1, $2, 'OK Syntet', 'CLUB', 'ok syntet', now()) returning id`, [randomUUID(), `a4-${randomUUID().slice(0, 8)}`])).rows;
    expect((await answerAccountClubStep(db, { ...proof, request: { formatVersion: 1, organisationIds: [organisation!.id], freeText: "Annan klubb" } }))
      .status).toBe("ok");
    expect((await pool.query("select 1 from account_club_membership where account_id = $1", [duplicate.response.accountId])).rowCount).toBe(2);
    const linked = await linkAs(joel, { sub: id, email: google, email_verified: true });
    if (linked.status !== "move-needed") throw new Error(`Väntade en flytt: ${linked.status}`);
    expect(await moveGoogleLinkToAccount(db, { proof: joel.proof, pending: linked.pending, password: TEST_PASSWORD }))
      .toEqual({ status: "moved", googleEmail: google, sourceEmail: google });
    expect(await accountExists(duplicate.response.accountId)).toBe(false);
    expect((await pool.query("select 1 from account_club_membership where account_id = $1", [duplicate.response.accountId])).rowCount).toBe(0);
    expect((await googleLogin({ sub: id, email: google, email_verified: true })).response.accountId).toBe(joel.accountId);

    // En tillhörighet som ett klubbarkiv har avgjort för hand gör att kontot används.
    const otherId = sub();
    const decided = await googleLogin({ sub: otherId, email: gmail(), email_verified: true });
    await pool.query(`insert into account_club_membership (id, account_id, organisation_id, free_text, club_id, status, created_at, decided_by, decided_at)
      values ($1, $2, null, 'Annan klubb', null, 'DECLINED', now(), $3, now())`, [randomUUID(), decided.response.accountId, joel.accountId]);
    expect(await linkAs(joel, { sub: otherId, email: gmail(), email_verified: true })).toMatchObject({ status: "in-use" });
  }, 60_000);

  it("ändrat 2026-11-07: ett konto i bruk utan eget lösenord ger ett besked som går att följa (Glömt lösenordet, sedan ta bort)", async () => {
    const joel = await registerTestAccount(db);
    const id = sub();
    const google = gmail();
    const used = await googleLogin({ sub: id, email: google, email_verified: true });
    const usedProof = { sessionToken: used.sessionToken, csrfCookie: used.csrfToken, csrfHeader: used.csrfToken };
    await createOrganizerEvent(db, { ...usedProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Utan lösenord", raceName: "", raceDate: "2026-11-22", timeZone: "Europe/Stockholm" }) });
    expect(await linkAs(joel, { sub: id, email: google, email_verified: true }))
      .toEqual({ status: "in-use", googleEmail: google, sourceHasPassword: false });
    // Vägen i beskedet: på det kontot vägras Ta bort kopplingen tills det har ett lösenord (Glömt lösenordet), sedan går det.
    expect(await unlinkGoogleFromAccount(db, usedProof)).toEqual({ status: "last-login-method" });
    const requested = await requestPasswordReset(db, { formatVersion: 1, email: google });
    if (requested.status !== "accepted" || !requested.delivery) throw new Error("Återställningslänken saknas");
    const done = await completePasswordReset(db, { formatVersion: 1, token: requested.delivery.token, password: "eget-lösen-12" });
    if (done.status !== "authenticated") throw new Error(`Inget nytt lösenord: ${done.status}`);
    const after = { sessionToken: done.sessionToken, csrfCookie: done.csrfToken, csrfHeader: done.csrfToken };
    expect(await unlinkGoogleFromAccount(db, after)).toEqual({ status: "unlinked" });
    expect(await linkAs(joel, { sub: id, email: google, email_verified: true })).toEqual({ status: "linked", googleEmail: google });
    // Ett konto i bruk med eget lösenord: det vanliga beskedet.
    const otherId = sub();
    const withPassword = await registerTestAccount(db);
    expect(await linkAs(withPassword, { sub: otherId, email: gmail(), email_verified: true })).toMatchObject({ status: "linked" });
    await createOrganizerEvent(db, { ...withPassword.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Med lösenord", raceName: "", raceDate: "2026-11-23", timeZone: "Europe/Stockholm" }) });
    expect(await linkAs(joel, { sub: otherId, email: gmail(), email_verified: true })).toMatchObject({ status: "in-use", sourceHasPassword: true });
  }, 60_000);

  it("Ta bort kopplingen vägras när kontot då saknar sätt att logga in, men inte med ett eget lösenord", async () => {
    const onlyGoogle = await googleLogin({ sub: sub(), email: gmail(), email_verified: true });
    const proof = { sessionToken: onlyGoogle.sessionToken, csrfCookie: onlyGoogle.csrfToken, csrfHeader: onlyGoogle.csrfToken };
    expect(await readAccountProfile(db, proof)).toMatchObject({ response: { hasPassword: false } });
    expect(await unlinkGoogleFromAccount(db, proof)).toEqual({ status: "last-login-method" });
    expect((await pool.query("select 1 from user_account_google_identity where account_id = $1", [onlyGoogle.response.accountId])).rowCount).toBe(1);

    const joel = await registerTestAccount(db);
    expect(await linkAs(joel, { sub: sub(), email: gmail(), email_verified: true })).toMatchObject({ status: "linked" });
    expect(await unlinkGoogleFromAccount(db, { ...joel.proof, csrfHeader: null })).toEqual({ status: "forbidden" });
    expect(await unlinkGoogleFromAccount(db, joel.proof)).toEqual({ status: "unlinked" });
    expect(await unlinkGoogleFromAccount(db, joel.proof)).toEqual({ status: "not-linked" });
    expect((await readAccountProfile(db, joel.proof))).toMatchObject({ response: { hasPassword: true } });
    expect((await readAccountProfile(db, joel.proof) as { response: { google?: unknown } }).response.google).toBeUndefined();
  }, 60_000);
});

describe("ADR-0205 tillägg: superadmin.mjs google move", () => {
  it("flyttar kopplingen utan att ta bort källan, och med --delete-source-if-empty bara om källan är tom", async () => {
    const joel = await registerTestAccount(db);
    const google = gmail();
    const id = sub();
    const duplicate = await googleLogin({ sub: id, email: google, email_verified: true });
    // Utan flaggan: kopplingen flyttas (källan hittas på Googles adress) och källan står kvar.
    expect(await moveGoogleLinkByCommand(db, { source: google.toUpperCase(), target: joel.email, deleteSourceIfEmpty: false })).toEqual({
      status: "moved", googleEmail: google, sourceEmail: google, targetEmail: joel.email, replacedTargetLink: false, sourceDeleted: false,
      sourceUsage: { rows: 0, tables: 0 } });
    expect(await accountExists(duplicate.response.accountId)).toBe(true);
    expect((await googleLogin({ sub: id, email: google, email_verified: true })).response.accountId).toBe(joel.accountId);
    expect(await moveGoogleLinkByCommand(db, { source: google, target: joel.email, deleteSourceIfEmpty: true })).toEqual({ status: "same-account" });
    expect(await moveGoogleLinkByCommand(db, { source: "ingen@gmail.com", target: joel.email, deleteSourceIfEmpty: true }))
      .toEqual({ status: "source-not-found" });
    expect(await moveGoogleLinkByCommand(db, { source: google, target: "ingen@test.o-tid.se", deleteSourceIfEmpty: true }))
      .toEqual({ status: "target-not-found" });

    // Med flaggan och en tom källa (hittad på kontots adress): källan tas bort och det loggas som Serverkommando.
    const second = gmail();
    const secondId = sub();
    const empty = await googleLogin({ sub: secondId, email: second, email_verified: true });
    // Kopplingar från före migration 0082 saknar Googles adress.
    await pool.query("update user_account_google_identity set google_email = null where account_id = $1", [empty.response.accountId]);
    const other = await registerTestAccount(db);
    expect(await moveGoogleLinkByCommand(db, { source: second, target: other.email, deleteSourceIfEmpty: true })).toMatchObject({
      status: "moved", googleEmail: second, sourceDeleted: true, sourceUsage: { rows: 0, tables: 0 } });
    expect(await accountExists(empty.response.accountId)).toBe(false);
    expect((await pool.query("select actor_label from superadmin_action where target_id = $1", [empty.response.accountId])).rows)
      .toEqual([{ actor_label: "Serverkommando" }]);

    // Med flaggan och en källa som används: kopplingen flyttas, källan står kvar.
    const third = gmail();
    const thirdId = sub();
    const used = await googleLogin({ sub: thirdId, email: third, email_verified: true });
    await createOrganizerEvent(db, { sessionToken: used.sessionToken, csrfCookie: used.csrfToken, csrfHeader: used.csrfToken,
      idempotencyKey: `organizer-event-create:${randomUUID()}`, readBody: async () => ({ formatVersion: 1, eventName: "Används",
        raceName: "", raceDate: "2026-11-21", timeZone: "Europe/Stockholm" }) });
    const result = await moveGoogleLinkByCommand(db, { source: third, target: other.email, deleteSourceIfEmpty: true });
    expect(result).toMatchObject({ status: "moved", replacedTargetLink: true, sourceDeleted: false });
    expect(result.status === "moved" && result.sourceUsage.rows).toBeGreaterThan(0);
    expect(await accountExists(used.response.accountId)).toBe(true);
    expect((await googleLogin({ sub: thirdId, email: third, email_verified: true })).response.accountId).toBe(other.accountId);
  }, 60_000);
});

describe("ADR-0205 tillägg: Kom ihåg mig och Logga ut från alla enheter", () => {
  it("utan Kom ihåg mig gäller inloggningen tolv timmar; ett lösenordsbyte behåller slaget; alla enheter loggas ut", async () => {
    const account = await registerTestAccount(db);
    const span = (result: { response: { expiresAt: string } }, at: number) => Date.parse(result.response.expiresAt) - at;
    const at = Date.now();
    const short = await loginUserAccount(db, { formatVersion: 1, email: account.email, password: TEST_PASSWORD, remember: false });
    const long = await loginUserAccount(db, { formatVersion: 1, email: account.email, password: TEST_PASSWORD, remember: true });
    const old = await loginUserAccount(db, { formatVersion: 1, email: account.email, password: TEST_PASSWORD });
    if (short.status !== "authenticated" || long.status !== "authenticated" || old.status !== "authenticated") throw new Error("Inte inloggad");
    expect(Math.abs(span(short, at) - SHORT_SESSION_LIFETIME_MS)).toBeLessThan(60_000);
    expect(Math.abs(span(long, at) - SESSION_LIFETIME_MS)).toBeLessThan(60_000);
    expect(Math.abs(span(old, at) - SESSION_LIFETIME_MS)).toBeLessThan(60_000);
    const shortProof = { sessionToken: short.sessionToken, csrfCookie: short.csrfToken, csrfHeader: short.csrfToken };
    expect((await authenticateUserAccountSession(db, shortProof, new Date(at + SHORT_SESSION_LIFETIME_MS + 60_000))).status).toBe("unauthorized");
    const changed = await changeAccountPassword(db, shortProof, { formatVersion: 1, currentPassword: TEST_PASSWORD, newPassword: "nytt-lösen-12" });
    if (changed.status !== "authenticated") throw new Error("Lösenordet byttes inte");
    expect(Math.abs(span(changed, Date.now()) - SHORT_SESSION_LIFETIME_MS)).toBeLessThan(60_000);

    const phone = await loginUserAccount(db, { formatVersion: 1, email: account.email, password: "nytt-lösen-12", remember: true });
    if (phone.status !== "authenticated") throw new Error("Inte inloggad");
    const proof = { sessionToken: changed.sessionToken, csrfCookie: changed.csrfToken, csrfHeader: changed.csrfToken };
    expect(await logoutAllUserAccountSessions(db, { ...proof, csrfHeader: null })).toEqual({ status: "forbidden" });
    expect(await logoutAllUserAccountSessions(db, proof)).toEqual({ status: "logged-out", sessions: 2 });
    expect((await authenticateUserAccountSession(db, { sessionToken: phone.sessionToken })).status).toBe("unauthorized");
    expect((await authenticateUserAccountSession(db, { sessionToken: changed.sessionToken })).status).toBe("unauthorized");
  }, 60_000);
});

describe("ändrat 2026-11-07: Ta bort kontot med en ny inloggning hos Google (kontot har inget eget lösenord)", () => {
  it("tas bort bara för samma session, samma Google-konto och en inloggning hos Google nyss; ensam ledare vägras först", async () => {
    const id = sub(), google = gmail();
    const account = await googleLogin({ sub: id, email: google, email_verified: true });
    const accountId = account.response.accountId;
    const proof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
    const boundSessionId = sessionIdOf(account.sessionToken);
    const now = new Date();
    const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
    const confirm = async (claims: Record<string, unknown>, bound = boundSessionId, at = now) => deleteAccountConfirmedWithGoogle(db,
      { proof, boundSessionId: bound, identity: await provider.identity({ sub: id, email: google, email_verified: true, ...claims }) }, at);
    // En annan inloggning än den som började, ett annat Google-konto, en gammal eller saknad inloggning hos Google: inget händer.
    expect(await confirm({ auth_time: seconds(now) }, randomUUID())).toEqual({ status: "session-mismatch" });
    expect(await confirm({ sub: sub(), auth_time: seconds(now) })).toEqual({ status: "other-google" });
    expect(await confirm({})).toEqual({ status: "stale-login" });
    expect(await confirm({ auth_time: seconds(new Date(now.getTime() - GOOGLE_DELETE_MAX_AGE_MS - 60_000)) })).toEqual({ status: "stale-login" });
    expect(["stale-login", "unauthorized"]).toContain((await confirm({ auth_time: seconds(now) }, boundSessionId,
      new Date(now.getTime() + GOOGLE_DELETE_MAX_AGE_MS + 60_000))).status);
    // K3: ensam ledare i en grupp får lämna över först.
    const group = await createTrainingGroup(db, { ...proof, request: { formatVersion: 1, requestId: randomUUID(), name: "Googlegruppen",
      code: `google-${randomUUID().slice(0, 8)}` } }, now);
    if (group.status !== "created") throw new Error(group.status);
    expect(await confirm({ auth_time: seconds(now) })).toMatchObject({ status: "sole-owner", soleOwnerOf: [{ kind: "TRAINING_GROUP", name: "Googlegruppen" }] });
    expect(await accountExists(accountId)).toBe(true);
    await pool.query("delete from training_group_member where group_id = $1", [group.group.groupId]);
    expect(await confirm({ auth_time: seconds(now) })).toEqual({ status: "deleted" });
    expect(await accountExists(accountId)).toBe(false);
  }, 60_000);

  it("ett konto med eget lösenord bekräftar med lösenordet, inte med Google", async () => {
    const joel = await registerTestAccount(db);
    const id = sub(), google = gmail();
    expect((await linkAs(joel, { sub: id, email: google, email_verified: true })).status).toBe("linked");
    const result = await deleteAccountConfirmedWithGoogle(db, { proof: joel.proof, boundSessionId: sessionIdOf(joel.proof.sessionToken),
      identity: await provider.identity({ sub: id, email: google, email_verified: true, auth_time: Math.floor(Date.now() / 1000) }) });
    expect(result).toEqual({ status: "has-password" });
    expect(await accountExists(joel.accountId)).toBe(true);
  }, 60_000);
});
