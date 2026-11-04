import {
  exchangeGoogleCode, googleAuthorizationUrl, GoogleOidcError, newGoogleLoginState, parseGoogleLoginState, sameState,
  serializeGoogleLoginState, signInWithGoogle, type GoogleOidcConfig
} from "@o-tid/application";
import { organizerAccountLoginResponseSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { googleLoginEnabled } from "./google-login-enabled";
import { googleLoginCookieName } from "./organizer-account-cookies";
import {
  SecurityConfigurationError, clientAddress, privateHeaders, readUniqueCookie, securityPolicy, setSessionCookies, type SecurityPolicy
} from "./security-policy";
import { logServerError } from "./server-error-log";

/**
 * Logga in med Google (ADR-0205 beslut 5). `GET /api/account/google/start` sparar state, nonce och PKCE-verifieraren i en
 * kortlivad kaka och skickar vidare till Google; `GET /api/account/google/callback` kontrollerar state mot kakan, byter koden
 * mot en ID-token (kontrollerad mot Googles JWKS) och loggar in som en vanlig inloggning. Bara när `OTID_GOOGLE_CLIENT_ID`
 * och `OTID_GOOGLE_CLIENT_SECRET` är satta; annars svarar båda 404.
 */
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN" | "OTID_GOOGLE_CLIENT_ID" | "OTID_GOOGLE_CLIENT_SECRET">>;

export const GOOGLE_CALLBACK_PATH = "/api/account/google/callback";

/** Felkoderna som inloggningssidan visar (`/organizer?google=…`). */
export type GoogleLoginProblem = "avbruten" | "obekraftad" | "sparrad" | "fel";


function configuration(environment: Environment): { policy: SecurityPolicy; config: GoogleOidcConfig } | undefined {
  if (!googleLoginEnabled(environment)) return undefined;
  let policy: SecurityPolicy;
  try { policy = securityPolicy(environment); }
  catch (error) { if (error instanceof SecurityConfigurationError) return undefined; throw error; }
  return { policy, config: { clientId: environment.OTID_GOOGLE_CLIENT_ID!.trim(), clientSecret: environment.OTID_GOOGLE_CLIENT_SECRET!.trim(),
    redirectUri: `${policy.publicOrigin}${GOOGLE_CALLBACK_PATH}` } };
}

function loginCookie(policy: SecurityPolicy, value: string, maxAgeSeconds: number): string {
  return [`${googleLoginCookieName(policy.secureCookies)}=${value}`, "Path=/", `Max-Age=${maxAgeSeconds}`, "SameSite=Lax", "HttpOnly",
    ...(policy.secureCookies ? ["Secure"] : [])].join("; ");
}

function notFound(): Response {
  return new Response(null, { status: 404, headers: privateHeaders });
}

function redirect(location: string, cookies: readonly string[] = []): Response {
  const response = new Response(null, { status: 303, headers: { ...privateHeaders, location } });
  for (const cookie of cookies) response.headers.append("set-cookie", cookie);
  return response;
}

export function googleStartRoute(request: Request, environment: Environment = process.env, now = new Date()): Response {
  const configured = configuration(environment);
  if (!configured || request.method !== "GET") return notFound();
  const login = newGoogleLoginState(now);
  return redirect(googleAuthorizationUrl(configured.config, login), [loginCookie(configured.policy, serializeGoogleLoginState(login), 600)]);
}

export interface GoogleCallbackDependencies {
  exchange?: typeof exchangeGoogleCode;
  signIn?: typeof signInWithGoogle;
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
  if (params.get("error")) return back(params.get("error") === "access_denied" ? "avbruten" : "fel");
  const code = params.get("code");
  if (!login || !code || code.length > 2048 || !sameState(login.state, params.get("state"))) return back("fel");
  try {
    const identity = await (dependencies.exchange ?? exchangeGoogleCode)(config, { code, login }, { now });
    const result = await (dependencies.signIn ?? signInWithGoogle)(db, identity, { now, clientKey: clientAddress(request) });
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

/** Sidan efter lyckad inloggning: går vidare direkt (meta refresh, inget skript) och har en länk om det dröjer. */
function continuePage(): string {
  return "<!doctype html><html lang=\"sv\"><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex\">"
    + "<meta http-equiv=\"refresh\" content=\"0;url=/organizer\"><title>Inloggad – O-Tid</title></head>"
    + "<body><p>Du är inloggad. <a href=\"/organizer\">Fortsätt till Mina tävlingar</a></p></body></html>";
}
