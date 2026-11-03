import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { createDatabase, migrate } from "@o-tid/database";
import { authenticateUserAccountSession, loginUserAccount, MAX_FAILED_ATTEMPTS_PER_CLIENT } from "../../src/user-account";
import { checkEmailVerificationToken, registerUserAccountWithVerification, verifyEmailAndLogIn } from "../../src/email-verification";
import { completePasswordReset, requestPasswordReset } from "../../src/password-reset";
import { createOrganizerEvent } from "../../src/organizer-events";
import { grantRacePersonAsAdmin } from "../../src/race-people";
import {
  exchangeGoogleCode, googleAuthorizationUrl, GoogleOidcError, newGoogleLoginState, type GoogleEndpoints, type GoogleOidcConfig
} from "../../src/google-oidc";
import { signInWithGoogle } from "../../src/google-login";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0205: kontot från klubbmötet 2026-11-03. Fel lösenord vid registreringen, ett bekräftelsemejl och ett återställningsmejl
 * i olika ordning och från olika enheter ska alltid leda in. Inloggning med Google mot en falsk OpenID-leverantör (egen
 * nyckel, JWKS och tokenändpunkt över HTTP).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("ADR-0205-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0205_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

const INTENDED = "rätt-lösen-1";
const TYPO = "rätt-lösen-1x";
const LAPTOP = "203.0.113.10";
const PHONE = "198.51.100.20";
const email = () => `klubb.${randomUUID().slice(0, 8)}@test.o-tid.se`;
const login = (address: string, password: string, clientKey = LAPTOP) =>
  loginUserAccount(db, { formatVersion: 1, email: address, password }, { clientKey, requireVerifiedEmail: true });

async function register(address: string, password = TYPO) {
  const result = await registerUserAccountWithVerification(db, { formatVersion: 1, email: address, displayName: "Klubbmedlem", password },
    { clientKey: LAPTOP });
  if (result.delivery?.kind !== "VERIFY") throw new Error("Bekräftelsemejlet saknas");
  return result.delivery.token;
}

async function resetToken(address: string, clientKey = LAPTOP) {
  const result = await requestPasswordReset(db, { formatVersion: 1, email: address }, { clientKey });
  if (result.status !== "accepted" || !result.delivery) throw new Error("Återställningsmejlet saknas");
  return result.delivery.token;
}

/** En inbjudan (funktionär) till adressen, sparad innan kontot är bekräftat. */
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

const acceptedInvitations = async (address: string) =>
  (await pool.query("select 1 from race_person_invitation where email = $1 and accepted_at is not null", [address])).rowCount;

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 120_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0205_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

describe("ADR-0205: fel lösenord vid registreringen", () => {
  it("ordning 1 och 2: sex försök med det tänkta lösenordet, återställning från telefonen, inloggning på datorn, gamla länken", async () => {
    const address = email();
    const verifyToken = await register(address);
    await invite(address);
    // Det tänkta lösenordet stämmer inte (registreringen fick ett annat); efter fem fel spärras adressen från datorn.
    const attempts = [];
    for (let i = 0; i < 6; i += 1) attempts.push((await login(address, INTENDED)).status);
    expect(attempts).toEqual(["unauthorized", "unauthorized", "unauthorized", "unauthorized", "unauthorized", "rate-limited"]);

    // Återställningslänken öppnas i telefonens webbläsare: obekräftat konto, nytt lösenord, bekräftad adress och inloggad där.
    const reset = await completePasswordReset(db, { formatVersion: 1, token: await resetToken(address, PHONE), password: INTENDED },
      { clientKey: PHONE });
    expect(reset).toMatchObject({ status: "authenticated", response: { email: address, emailVerified: true } });
    expect(await acceptedInvitations(address)).toBe(1);

    // Tillbaka på datorn: spärren gäller inte längre, eftersom lösenordet har bytts efter felen (förut: "För många försök").
    expect(await login(address, INTENDED)).toMatchObject({ status: "authenticated", response: { emailVerified: true } });

    // Ordning 2: den gamla bekräftelselänken efter återställningen säger att adressen redan är bekräftad, utan lösenord.
    expect(await checkEmailVerificationToken(db, { formatVersion: 1, token: verifyToken })).toEqual({ status: "checked", state: "already-verified" });
    expect(await verifyEmailAndLogIn(db, { formatVersion: 1, token: verifyToken, password: "något-annat-1" })).toEqual({ status: "already-verified" });
    expect((await login(address, "något-annat-1")).status).toBe("unauthorized");
    expect((await login(address, INTENDED)).status).toBe("authenticated");
  }, 60_000);

  it("ordning 3: bekräftelselänken först, med det tänkta lösenordet, sedan återställning", async () => {
    const address = email();
    const verifyToken = await register(address);
    await invite(address);
    expect((await login(address, INTENDED)).status).toBe("unauthorized");
    // Länken kräver inte registreringens lösenord: den bevisar adressen och personen väljer lösenordet nu.
    expect(await checkEmailVerificationToken(db, { formatVersion: 1, token: verifyToken })).toEqual({ status: "checked", state: "valid" });
    const verified = await verifyEmailAndLogIn(db, { formatVersion: 1, token: verifyToken, password: INTENDED }, { clientKey: PHONE });
    expect(verified).toMatchObject({ status: "authenticated", response: { emailVerified: true } });
    expect(await acceptedInvitations(address)).toBe(1);
    expect((await login(address, TYPO)).status).toBe("unauthorized");
    expect((await login(address, INTENDED)).status).toBe("authenticated");
    // Länken fungerar en gång; därefter "redan bekräftad".
    expect(await verifyEmailAndLogIn(db, { formatVersion: 1, token: verifyToken, password: INTENDED })).toEqual({ status: "already-verified" });

    // Återställningen fungerar sedan som vanligt och loggar ut den andra enheten.
    if (verified.status !== "authenticated") throw new Error("Inte inloggad");
    const again = await completePasswordReset(db, { formatVersion: 1, token: await resetToken(address), password: "tredje-lösen-3" });
    expect(again.status).toBe("authenticated");
    expect((await authenticateUserAccountSession(db, { sessionToken: verified.sessionToken })).status).toBe("unauthorized");
    expect((await login(address, "tredje-lösen-3")).status).toBe("authenticated");
  }, 60_000);

  it("en återställning förbrukar bekräftelselänken och en bekräftelse lämnar återställningslänken till sin timme", async () => {
    const address = email();
    const verifyToken = await register(address);
    const resetFirst = await resetToken(address);
    // Båda mejlen har kommit; personen öppnar återställningen först, sedan bekräftelsen.
    expect((await completePasswordReset(db, { formatVersion: 1, token: resetFirst, password: INTENDED })).status).toBe("authenticated");
    expect(await verifyEmailAndLogIn(db, { formatVersion: 1, token: verifyToken, password: INTENDED })).toEqual({ status: "already-verified" });

    const other = email();
    const otherVerify = await register(other);
    const otherReset = await resetToken(other);
    expect((await verifyEmailAndLogIn(db, { formatVersion: 1, token: otherVerify, password: INTENDED })).status).toBe("authenticated");
    expect((await completePasswordReset(db, { formatVersion: 1, token: otherReset, password: "nytt-lösen-22" })).status).toBe("authenticated");
    expect((await login(other, "nytt-lösen-22")).status).toBe("authenticated");
  }, 60_000);

  it("en gammal eller förbrukad länk till ett obekräftat konto säger ogiltig, och ett spärrat konto kommer inte in", async () => {
    const address = email();
    await register(address);
    expect(await checkEmailVerificationToken(db, { formatVersion: 1, token: "A".repeat(43) })).toEqual({ status: "checked", state: "invalid" });
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const token = await register(address);
    expect(await verifyEmailAndLogIn(db, { formatVersion: 1, token, password: INTENDED }, { now: later })).toEqual({ status: "invalid-token" });
    expect(await verifyEmailAndLogIn(db, { formatVersion: 1, token, password: "kort" })).toEqual({ status: "invalid-request" });
    await pool.query("update user_account set blocked_at = now() where email = $1", [address]);
    expect(await verifyEmailAndLogIn(db, { formatVersion: 1, token, password: INTENDED })).toEqual({ status: "invalid-token" });
  }, 60_000);

  it("spärren per IP-adress (klubbens nät) gäller andra adresser men inte den som just bytt lösenord", async () => {
    const clubIp = "192.0.2.77";
    const address = email();
    await register(address);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS_PER_CLIENT; i += 1) await login(email(), "fel-lösen-1", clubIp);
    expect((await login(address, INTENDED, clubIp)).status).toBe("rate-limited");
    expect((await completePasswordReset(db, { formatVersion: 1, token: await resetToken(address, PHONE), password: INTENDED })).status)
      .toBe("authenticated");
    expect((await login(address, INTENDED, clubIp)).status).toBe("authenticated");
    expect((await login(email(), "fel-lösen-1", clubIp)).status).toBe("rate-limited");
  }, 120_000);
});

/** Falsk OpenID-leverantör: auktorisering (koden knyts till PKCE-utmaningen och nonce), tokenändpunkt och JWKS. */
interface Provider { endpoints: GoogleEndpoints; config: GoogleOidcConfig; authorize(authorizationUrl: string, claims: Record<string, unknown>): string;
  close(): Promise<void>; signWith(key: "own" | "foreign"): void }

async function startProvider(): Promise<Provider> {
  const own = await generateKeyPair("RS256");
  const foreign = await generateKeyPair("RS256");
  const jwk: JWK = { ...await exportJWK(own.publicKey), kid: "nyckel-1", alg: "RS256", use: "sig" };
  const codes = new Map<string, { challenge: string; claims: Record<string, unknown> }>();
  let signing = own.privateKey;
  let issuer = "";
  const server: Server = createServer((request, response) => {
    if (request.url === "/certs") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ keys: [jwk] })); return; }
    let body = "";
    request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    request.on("end", () => void (async () => {
      const form = new URLSearchParams(body);
      const grant = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (!grant || grant.challenge !== challenge || form.get("client_secret") !== "hemlig" || form.get("redirect_uri") !== config.redirectUri) {
        response.statusCode = 400; response.end(JSON.stringify({ error: "invalid_grant" })); return;
      }
      const idToken = await new SignJWT({ ...grant.claims }).setProtectedHeader({ alg: "RS256", kid: "nyckel-1" }).sign(signing);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ access_token: "x", id_token: idToken, token_type: "Bearer" }));
    })());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  issuer = "https://accounts.google.com";
  const endpoints: GoogleEndpoints = { authorization: `${origin}/auth`, token: `${origin}/token`, jwks: `${origin}/certs`, issuers: [issuer] };
  const config: GoogleOidcConfig = { clientId: "otid-klient.apps.googleusercontent.com", clientSecret: "hemlig",
    redirectUri: "https://otid.example/api/account/google/callback", endpoints };
  return {
    endpoints, config,
    authorize(authorizationUrl, claims) {
      const params = new URL(authorizationUrl).searchParams;
      expect(params.get("code_challenge_method")).toBe("S256");
      expect(params.get("scope")).toBe("openid email profile");
      const code = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      codes.set(code, { challenge: params.get("code_challenge")!, claims: { iss: issuer, aud: config.clientId, iat: now, exp: now + 300,
        nonce: params.get("nonce"), ...claims } });
      return code;
    },
    signWith(key) { signing = key === "own" ? own.privateKey : foreign.privateKey; },
    close: () => new Promise<void>(resolve => server.close(() => resolve()))
  };
}

describe("ADR-0205: inloggning med Google mot en falsk leverantör", () => {
  let provider: Provider;
  beforeAll(async () => { provider = await startProvider(); });
  afterAll(async () => { await provider.close(); });

  /** Hela flödet utan databasen: start (state, nonce, PKCE), leverantören, kodbytet och ID-token. */
  async function flow(claims: Record<string, unknown>, tamper: (login: ReturnType<typeof newGoogleLoginState>) => void = () => undefined) {
    const login = newGoogleLoginState();
    const code = provider.authorize(googleAuthorizationUrl(provider.config, login), claims);
    tamper(login);
    return exchangeGoogleCode(provider.config, { code, login });
  }
  const failure = async (promise: Promise<unknown>) => { try { await promise; return "ok"; } catch (error) { return error instanceof GoogleOidcError ? error.code : String(error); } };

  it("skapar ett konto med bekräftad adress och loggar in; nästa gång samma konto", async () => {
    const address = email();
    const identity = await flow({ sub: "1000001", email: address.toUpperCase(), email_verified: true, name: "Gunnel Google" });
    expect(identity).toEqual({ sub: "1000001", email: address.toUpperCase(), emailVerified: true, name: "Gunnel Google" });
    const first = await signInWithGoogle(db, identity);
    expect(first).toMatchObject({ status: "authenticated", created: true, response: { email: address, displayName: "Gunnel Google", emailVerified: true } });
    if (first.status !== "authenticated") throw new Error("Inte inloggad");
    expect((await authenticateUserAccountSession(db, { sessionToken: first.sessionToken })).status).toBe("authenticated");
    const second = await signInWithGoogle(db, await flow({ sub: "1000001", email: address, email_verified: true }));
    expect(second).toMatchObject({ status: "authenticated", created: false, response: { accountId: first.response.accountId } });
    // Inget lösenord som någon känner till; ett eget väljs med "Glömt lösenordet".
    expect((await login(address, "")).status).toBe("unauthorized");
    expect((await completePasswordReset(db, { formatVersion: 1, token: await resetToken(address), password: INTENDED })).status).toBe("authenticated");
    expect((await login(address, INTENDED)).status).toBe("authenticated");
  }, 60_000);

  it("avvisar obekräftad adress, fel nonce, fel aud, gammal token, fel nyckel och fel PKCE-verifierare", async () => {
    const address = email();
    expect(await signInWithGoogle(db, await flow({ sub: "1000002", email: address, email_verified: false }))).toEqual({ status: "email-not-verified" });
    expect(await signInWithGoogle(db, await flow({ sub: "1000002", email: address }))).toEqual({ status: "email-not-verified" });
    expect((await pool.query("select 1 from user_account where email = $1", [address])).rowCount).toBe(0);
    expect(await failure(flow({ sub: "1000002", email: address, email_verified: true, nonce: "A".repeat(43) }))).toBe("nonce");
    expect(await failure(flow({ sub: "1000002", email: address, email_verified: true, aud: "nagon-annan" }))).toBe("id-token");
    expect(await failure(flow({ sub: "1000002", email: address, email_verified: true, azp: "nagon-annan" }))).toBe("id-token");
    expect(await failure(flow({ sub: "1000002", email: address, email_verified: true, iss: "https://evil.example" }))).toBe("id-token");
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(await failure(flow({ sub: "1000002", email: address, email_verified: true, iat: old - 300, exp: old }))).toBe("id-token");
    provider.signWith("foreign");
    expect(await failure(flow({ sub: "1000002", email: address, email_verified: true }))).toBe("id-token");
    provider.signWith("own");
    expect(await failure(flow({ sub: "1000002", email: address, email_verified: true }, login => { login.codeVerifier = "B".repeat(43); })))
      .toBe("token-exchange");
  }, 60_000);

  it("kopplar ett obekräftat konto: adressen bekräftas, registreringens lösenord slutar gälla och inbjudningar tas", async () => {
    const address = email();
    // Någon (kanske inte personen själv) har registrerat adressen med ett lösenord som personen inte känner till.
    await register(address, "nagon-annans-1");
    await invite(address);
    const signed = await signInWithGoogle(db, await flow({ sub: "1000003", email: address, email_verified: true, name: "Ny" }));
    expect(signed).toMatchObject({ status: "authenticated", created: false, response: { email: address, displayName: "Klubbmedlem", emailVerified: true } });
    expect(await acceptedInvitations(address)).toBe(1);
    expect((await loginUserAccount(db, { formatVersion: 1, email: address, password: "nagon-annans-1" })).status).toBe("unauthorized");
  }, 60_000);

  it("ett bekräftat konto behåller lösenordet och ett spärrat konto förblir spärrat", async () => {
    const verified = await registerTestAccount(db);
    expect((await signInWithGoogle(db, await flow({ sub: "1000004", email: verified.email, email_verified: true }))).status).toBe("authenticated");
    expect((await loginUserAccount(db, { formatVersion: 1, email: verified.email, password: verified.password })).status).toBe("authenticated");

    const blocked = await registerTestAccount(db);
    await pool.query("update user_account set blocked_at = now() where id = $1", [blocked.accountId]);
    expect(await signInWithGoogle(db, await flow({ sub: "1000005", email: blocked.email, email_verified: true }))).toEqual({ status: "blocked" });
    expect((await pool.query("select 1 from user_account_google_identity where google_sub = '1000005'")).rowCount).toBe(0);
    // Spärras kontot efter kopplingen gäller spärren också för Google.
    await pool.query("update user_account set blocked_at = now() where id = $1", [verified.accountId]);
    expect(await signInWithGoogle(db, await flow({ sub: "1000004", email: verified.email, email_verified: true }))).toEqual({ status: "blocked" });
  }, 60_000);
});
