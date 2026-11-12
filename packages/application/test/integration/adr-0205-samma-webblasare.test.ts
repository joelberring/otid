import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { loginUserAccount } from "../../src/user-account";
import {
  checkEmailVerificationToken, newRegistrationBrowserSecret, registerUserAccountWithVerification, REGISTRATION_BROWSER_LIFETIME_MS,
  verifyEmailAndLogIn
} from "../../src/email-verification";
import { completePasswordReset, requestPasswordReset } from "../../src/password-reset";
import { createOrganizerEvent } from "../../src/organizer-events";
import { grantRacePersonAsAdmin } from "../../src/race-people";
import { signInWithGoogle } from "../../src/google-login";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0205 tillägg 2026-11-12 ("två gånger räcker"): bekräftelselänken som öppnas i webbläsaren som registrerade (kakans
 * hemlighet, bunden till just den registreringen) bekräftar adressen med lösenordet från registreringsformuläret. Någon annan
 * stans väljer man lösenord som förut, och den som registrerat någon annans adress får aldrig kontot med sitt lösenord.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_samma_webblasare_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 120_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_samma_webblasare_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const OWN = "mitt-lösen-1";
const OTHER = "någon-annans-2";
const email = () => `webblasare.${randomUUID().slice(0, 8)}@test.o-tid.se`;
const login = (address: string, password: string) =>
  loginUserAccount(db, { formatVersion: 1, email: address, password }, { requireVerifiedEmail: true });

async function register(address: string, password: string, browserSecret?: string, now?: Date) {
  const result = await registerUserAccountWithVerification(db, { formatVersion: 1, email: address, displayName: "Ny", password },
    { ...(browserSecret ? { browserSecret } : {}), ...(now ? { now } : {}) });
  if (result.delivery?.kind !== "VERIFY") throw new Error("Bekräftelsemejlet saknas");
  return result.delivery.token;
}
const check = (token: string, browserSecret?: string, now?: Date) =>
  checkEmailVerificationToken(db, { formatVersion: 1, token }, { ...(browserSecret ? { browserSecret } : {}), ...(now ? { now } : {}) });
const confirm = (token: string, browserSecret?: string, now?: Date) =>
  verifyEmailAndLogIn(db, { formatVersion: 1, token }, { ...(browserSecret ? { browserSecret } : {}), ...(now ? { now } : {}) });
const copies = async (address: string) => (await pool.query<{ n: number }>(`select count(*)::int as n from email_verification_token t
  join user_account a on a.id = t.account_id where a.email = $1 and (t.browser_secret_hash is not null or t.verifier_hex is not null)`,
[address])).rows[0]!.n;

describe("ADR-0205 tillägg: bekräftelselänken i samma webbläsare", () => {
  it("samma webbläsare: inget nytt lösenord, registreringens gäller; kopiorna töms och länken fungerar en gång", async () => {
    const address = email();
    const secret = newRegistrationBrowserSecret();
    const token = await register(address, OWN, secret);
    expect(await copies(address)).toBe(1);
    expect(await check(token, secret)).toEqual({ status: "checked", state: "valid", sameBrowser: true });
    const verified = await confirm(token, secret);
    expect(verified).toMatchObject({ status: "authenticated", response: { email: address, emailVerified: true } });
    expect((await login(address, OWN)).status).toBe("authenticated");
    expect(await copies(address)).toBe(0);
    expect(await confirm(token, secret)).toEqual({ status: "already-verified" });
  }, 60_000);

  it("annan webbläsare, fel eller saknad kaka och efter en timme: lösenordet måste väljas, och inget ändras utan det", async () => {
    const address = email();
    const secret = newRegistrationBrowserSecret();
    const registeredAt = new Date();
    const token = await register(address, OWN, secret, registeredAt);
    for (const other of [undefined, newRegistrationBrowserSecret(), "kort", "R".repeat(43)]) {
      expect(await check(token, other)).toEqual({ status: "checked", state: "valid" });
      expect(await confirm(token, other)).toEqual({ status: "password-required" });
    }
    const late = new Date(registeredAt.getTime() + REGISTRATION_BROWSER_LIFETIME_MS + 1000);
    expect(await check(token, secret, late)).toEqual({ status: "checked", state: "valid" });
    expect(await confirm(token, secret, late)).toEqual({ status: "password-required" });
    expect((await login(address, OWN)).status).toBe("unauthorized");
    // Med lösenord fungerar länken som förut (också i samma webbläsare: "Välj ett annat lösenord").
    expect((await verifyEmailAndLogIn(db, { formatVersion: 1, token, password: "valt-nu-3" }, { browserSecret: secret })).status)
      .toBe("authenticated");
    expect((await login(address, OWN)).status).toBe("unauthorized");
    expect((await login(address, "valt-nu-3")).status).toBe("authenticated");
  }, 60_000);

  it("någon annan registrerade adressen först: ägarens länk i ägarens webbläsare ger ägarens lösenord, aldrig den andras", async () => {
    const address = email();
    const intruder = newRegistrationBrowserSecret();
    const intruderToken = await register(address, OTHER, intruder);
    const owner = newRegistrationBrowserSecret();
    const ownerToken = await register(address, OWN, owner);
    // Bindningen gäller bara registreringen som skapade länken: den andras kaka bekräftar inte ägarens länk, och tvärtom.
    expect(await confirm(ownerToken, intruder)).toEqual({ status: "password-required" });
    expect(await confirm(intruderToken, owner)).toEqual({ status: "password-required" });
    expect(await confirm(ownerToken, owner)).toMatchObject({ status: "authenticated", response: { emailVerified: true } });
    expect((await login(address, OTHER)).status).toBe("unauthorized");
    expect((await login(address, OWN)).status).toBe("authenticated");
    // Den andras länk (i ägarens inkorg) säger nu bara "redan bekräftad".
    expect(await confirm(intruderToken, intruder)).toEqual({ status: "already-verified" });
  }, 60_000);

  it("den inbjudna utan konto: registrering och länken i samma webbläsare tar inbjudan", async () => {
    const address = email();
    const owner = await registerTestAccount(db);
    const created = await createOrganizerEvent(db, { ...owner.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Klubbträning", raceName: "Tisdag", raceDate: "2026-11-10", timeZone: "Europe/Stockholm" }) });
    if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
    const requestId = randomUUID();
    expect((await grantRacePersonAsAdmin(db, { ...owner.proof, raceId: created.response.raceId, idempotencyKey: `race-person-grant:${requestId}`,
      readBody: async () => ({ formatVersion: 1, requestId, email: address, role: "FUNCTIONARY" }) })).status).toBe("granted");
    const secret = newRegistrationBrowserSecret();
    const token = await register(address, OWN, secret);
    expect((await confirm(token, secret)).status).toBe("authenticated");
    expect((await pool.query("select 1 from race_person_invitation where email = $1 and accepted_at is not null", [address])).rowCount).toBe(1);
  }, 60_000);

  it("Google eller återställningen först: länken förbrukas och kopiorna töms, så kakan ger inget efteråt", async () => {
    const googled = email();
    const secret = newRegistrationBrowserSecret();
    const token = await register(googled, OWN, secret);
    expect(await signInWithGoogle(db, { sub: `g-${randomUUID()}`, email: googled, emailVerified: true, name: "Gunnel" }))
      .toMatchObject({ status: "authenticated", response: { emailVerified: true } });
    expect(await copies(googled)).toBe(0);
    expect(await confirm(token, secret)).toEqual({ status: "already-verified" });
    // ADR-0205 beslut 5: obekräftat konto får ett slumpat lösenord vid Google; registreringens gäller inte.
    expect((await login(googled, OWN)).status).toBe("unauthorized");

    const reset = email();
    const resetSecret = newRegistrationBrowserSecret();
    const resetVerify = await register(reset, OWN, resetSecret);
    const requested = await requestPasswordReset(db, { formatVersion: 1, email: reset });
    if (requested.status !== "accepted" || !requested.delivery) throw new Error("Återställningsmejlet saknas");
    expect((await completePasswordReset(db, { formatVersion: 1, token: requested.delivery.token, password: "nytt-lösen-4" })).status).toBe("authenticated");
    expect(await copies(reset)).toBe(0);
    expect(await confirm(resetVerify, resetSecret)).toEqual({ status: "already-verified" });
    expect((await login(reset, "nytt-lösen-4")).status).toBe("authenticated");
  }, 60_000);
});
