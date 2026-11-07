import {
  exchangeGoogleCode, googleAuthorizationUrl, GoogleOidcError, linkGoogleToAccount, newGoogleLoginState, parseGoogleLoginState, sameState,
  serializeGoogleLoginState, serializeGoogleMovePending, signInWithGoogle, GOOGLE_MOVE_LIFETIME_MS, type GoogleEndpoints, type GoogleLoginState, type GoogleOidcConfig
} from "@o-tid/application";
import { organizerAccountLoginResponseSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { googleLoginEnabled } from "./google-login-enabled";
import { googleLoginCookieName, googleMoveCookieName } from "./organizer-account-cookies";
import {
  SecurityConfigurationError, clientAddress, privateHeaders, readUniqueCookie, securityPolicy, sessionProof, setSessionCookies, type SecurityPolicy
} from "./security-policy";
import { logServerError } from "./server-error-log";

/**
 * Logga in med Google (ADR-0205 beslut 5). `GET /api/account/google/start` sparar state, nonce och PKCE-verifieraren i en
 * kortlivad kaka och skickar vidare till Google; `GET /api/account/google/callback` kontrollerar state mot kakan, byter koden
 * mot en ID-token (kontrollerad mot Googles JWKS) och loggar in som en vanlig inloggning. Bara när `OTID_GOOGLE_CLIENT_ID`
 * och `OTID_GOOGLE_CLIENT_SECRET` är satta; annars svarar båda 404.
 */
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN" | "OTID_GOOGLE_CLIENT_ID" | "OTID_GOOGLE_CLIENT_SECRET"
  | "OTID_GOOGLE_BASE_URL" | "OTID_GOOGLE_AUTHORIZE_URL">>;

/**
 * Endast test (som `OTID_EVENTOR_BASE_URL`): en falsk OpenID-leverantör i stället för Google. `OTID_GOOGLE_BASE_URL` är serverns
 * väg dit (`/token`, `/certs`, och utgivaren `iss`); `OTID_GOOGLE_AUTHORIZE_URL` är webbläsarens (förval `{bas}/auth`). Tomt i drift.
 */
function testEndpoints(environment: Environment): GoogleEndpoints | undefined {
  const base = environment.OTID_GOOGLE_BASE_URL?.trim().replace(/\/$/, "");
  if (!base) return undefined;
  return { authorization: environment.OTID_GOOGLE_AUTHORIZE_URL?.trim() || `${base}/auth`, token: `${base}/token`, jwks: `${base}/certs`,
    issuers: [base] };
}

export const GOOGLE_CALLBACK_PATH = "/api/account/google/callback";

/** Felkoderna som inloggningssidan visar (`/organizer?google=…`). */
export type GoogleLoginProblem = "avbruten" | "obekraftad" | "sparrad" | "fel";
/** ADR-0205 tillägg: beskeden efter "Koppla Google-konto" (`/konto?google=…`). */
export type GoogleLinkOutcome = "kopplat" | "upptaget" | "upptaget-utan-losenord" | "obekraftad" | "sessionen" | "avbruten" | "fel";
/** Sidan som bekräftar en flytt av kopplingen från ett tomt konto. */
export const GOOGLE_MOVE_PAGE = "/konto/flytta-google";

export function configuration(environment: Environment): { policy: SecurityPolicy; config: GoogleOidcConfig } | undefined {
  if (!googleLoginEnabled(environment)) return undefined;
  let policy: SecurityPolicy;
  try { policy = securityPolicy(environment); }
  catch (error) { if (error instanceof SecurityConfigurationError) return undefined; throw error; }
  const endpoints = testEndpoints(environment);
  return { policy, config: { clientId: environment.OTID_GOOGLE_CLIENT_ID!.trim(), clientSecret: environment.OTID_GOOGLE_CLIENT_SECRET!.trim(),
    redirectUri: `${policy.publicOrigin}${GOOGLE_CALLBACK_PATH}`, ...(endpoints ? { endpoints } : {}) } };
}

export function loginCookie(policy: SecurityPolicy, value: string, maxAgeSeconds: number): string {
  return [`${googleLoginCookieName(policy.secureCookies)}=${value}`, "Path=/", `Max-Age=${maxAgeSeconds}`, "SameSite=Lax", "HttpOnly",
    ...(policy.secureCookies ? ["Secure"] : [])].join("; ");
}

/** Den påbörjade flytten (signerad); SameSite=Strict, bara O-Tids egna sidor läser den. */
export function moveCookie(policy: SecurityPolicy, value: string, maxAgeSeconds: number): string {
  return [`${googleMoveCookieName(policy.secureCookies)}=${value}`, "Path=/", `Max-Age=${maxAgeSeconds}`, "SameSite=Strict", "HttpOnly",
    ...(policy.secureCookies ? ["Secure"] : [])].join("; ");
}

export function notFound(): Response {
  return new Response(null, { status: 404, headers: privateHeaders });
}

/** Adressen till Google med en ny påbörjad inloggning eller koppling, och kakan som håller den (tio minuter). */
export function googleRedirect(configured: { policy: SecurityPolicy; config: GoogleOidcConfig }, login: GoogleLoginState)
  : { location: string; cookie: string } {
  return { location: googleAuthorizationUrl(configured.config, login), cookie: loginCookie(configured.policy, serializeGoogleLoginState(login), 600) };
}

export function redirect(location: string, cookies: readonly string[] = []): Response {
  const response = new Response(null, { status: 303, headers: { ...privateHeaders, location } });
  for (const cookie of cookies) response.headers.append("set-cookie", cookie);
  return response;
}

export function googleStartRoute(request: Request, environment: Environment = process.env, now = new Date()): Response {
  const configured = configuration(environment);
  if (!configured || request.method !== "GET") return notFound();
  // ADR-0205 tillägg: "Kom ihåg mig på den här datorn" följer med som `?remember=1`; utan den en kort session.
  const remember = new URL(request.url).searchParams.get("remember") === "1";
  const started = googleRedirect(configured, newGoogleLoginState(now, { remember }));
  return redirect(started.location, [started.cookie]);
}

export interface GoogleCallbackDependencies {
  exchange?: typeof exchangeGoogleCode;
  signIn?: typeof signInWithGoogle;
  link?: typeof linkGoogleToAccount;
  now?: Date;
}

/**
 * Tillbaka från Google. Lyckad inloggning: sessionens cookies och en liten sida som går vidare till Mina tävlingar. Sessionens
 * kakor är SameSite=Strict och skickas inte med en navigering som började hos Google, så sidan går vidare själv (samma webbplats).
 * Allt annat: tillbaka till inloggningen med ett besked (`?google=…`). Kakan med state tas alltid bort.
 */
export async function googleCallbackRoute(db: Database, request: Request, environment: Environment = process.env,
  dependencies: GoogleCallbackDependencies = {}): Promise<Response> {
  const configured = configuration(environment);
  if (!configured || request.method !== "GET") return notFound();
  const { policy, config } = configured;
  const clear = loginCookie(policy, "deleted", 0);
  const back = (problem: GoogleLoginProblem) => redirect(`${policy.publicOrigin}/organizer?google=${problem}`, [clear]);
  const params = new URL(request.url).searchParams;
  const now = dependencies.now ?? new Date();
  const login = parseGoogleLoginState(readUniqueCookie(request, googleLoginCookieName(policy.secureCookies)), now);
  if (login?.mode === "link") return linkCallback(db, request, configured, login, dependencies);
  if (params.get("error")) return back(params.get("error") === "access_denied" ? "avbruten" : "fel");
  const code = params.get("code");
  if (!login || !code || code.length > 2048 || !sameState(login.state, params.get("state"))) return back("fel");
  try {
    const identity = await (dependencies.exchange ?? exchangeGoogleCode)(config, { code, login }, { now });
    const result = await (dependencies.signIn ?? signInWithGoogle)(db, identity, { now, clientKey: clientAddress(request),
      remember: login.remember === true });
    if (result.status === "email-not-verified") return back("obekraftad");
    if (result.status === "blocked") return back("sparrad");
    if (result.status !== "authenticated") return back("fel");
    const response = organizerAccountLoginResponseSchema.parse(result.response);
    const page = new Response(continuePage(), { status: 200, headers: { ...privateHeaders, "content-type": "text/html; charset=utf-8" } });
    page.headers.append("set-cookie", clear);
    return setSessionCookies(page, policy, { sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt });
  } catch (error) {
    if (error instanceof GoogleOidcError) { console.error(`Google-inloggningen avvisades (${error.code}).`); return back("fel"); }
    logServerError("account", "googleCallbackRoute", error);
    return back("fel");
  }
}

/**
 * ADR-0205 tillägg: tillbaka från Google i läget "link" (Koppla Google-konto under Mitt konto). Sessionens kakor är
 * SameSite=Strict och följer inte med navigeringen från Google, så första besöket går vidare till samma adress med `steg=2`
 * från O-Tids egen sida (meta refresh); då följer sessionen med. Kopplingen gäller bara sessionen som började den.
 */
async function linkCallback(db: Database, request: Request, configured: { policy: SecurityPolicy; config: GoogleOidcConfig },
  login: GoogleLoginState, dependencies: GoogleCallbackDependencies): Promise<Response> {
  const { policy, config } = configured;
  const url = new URL(request.url);
  const params = url.searchParams;
  const clear = loginCookie(policy, "deleted", 0);
  const done = (outcome: GoogleLinkOutcome, cookies: readonly string[] = []) =>
    redirect(`${policy.publicOrigin}/konto?google=${outcome}`, [clear, ...cookies]);
  if (params.get("error")) return done(params.get("error") === "access_denied" ? "avbruten" : "fel");
  const code = params.get("code");
  if (!code || code.length > 2048 || !sameState(login.state, params.get("state"))) return done("fel");
  if (params.get("steg") !== "2") {
    const next = new URLSearchParams({ code, state: params.get("state")!, steg: "2" });
    return continueToPage(`${GOOGLE_CALLBACK_PATH}?${next.toString()}`, "Kopplar Google-kontot …", "Fortsätt");
  }
  const now = dependencies.now ?? new Date();
  try {
    const identity = await (dependencies.exchange ?? exchangeGoogleCode)(config, { code, login }, { now });
    const result = await (dependencies.link ?? linkGoogleToAccount)(db, { proof: sessionProof(request, policy, false),
      boundSessionId: login.sessionId!, identity }, now);
    switch (result.status) {
      case "linked": return done("kopplat");
      case "in-use": return done(result.sourceHasPassword ? "upptaget" : "upptaget-utan-losenord");
      case "email-not-verified": return done("obekraftad");
      case "move-needed":
        return redirect(`${policy.publicOrigin}${GOOGLE_MOVE_PAGE}`, [clear,
          moveCookie(policy, serializeGoogleMovePending(result.pending), Math.floor(GOOGLE_MOVE_LIFETIME_MS / 1000))]);
      case "invalid-identity": return done("fel");
      default: return done("sessionen");
    }
  } catch (error) {
    if (error instanceof GoogleOidcError) { console.error(`Google-kopplingen avvisades (${error.code}).`); return done("fel"); }
    logServerError("account", "googleLinkCallback", error);
    return done("fel");
  }
}

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** En liten sida som går vidare till `path` på samma webbplats (meta refresh, inget skript), med en länk om det dröjer. */
function continueToPage(path: string, title: string, link: string): Response {
  const target = escapeHtml(path);
  const html = "<!doctype html><html lang=\"sv\"><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex\">"
    + `<meta http-equiv="refresh" content="0;url=${target}"><title>${escapeHtml(title)} – O-Tid</title></head>`
    + `<body><p>${escapeHtml(title)} <a href="${target}">${escapeHtml(link)}</a></p></body></html>`;
  return new Response(html, { status: 200, headers: { ...privateHeaders, "content-type": "text/html; charset=utf-8" } });
}

/** Sidan efter lyckad inloggning: går vidare direkt (meta refresh, inget skript) och har en länk om det dröjer. */
function continuePage(): string {
  return "<!doctype html><html lang=\"sv\"><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex\">"
    + "<meta http-equiv=\"refresh\" content=\"0;url=/organizer\"><title>Inloggad – O-Tid</title></head>"
    + "<body><p>Du är inloggad. <a href=\"/organizer\">Fortsätt till Mina tävlingar</a></p></body></html>";
}
