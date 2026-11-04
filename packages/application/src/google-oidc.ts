import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Inloggning med Google (ADR-0205): OpenID Connect med kodflödet, PKCE (S256), `state` och `nonce`. ID-token kontrolleras
 * mot Googles nycklar (JWKS) med `iss`, `aud`, `exp` och `nonce`. Inget här rör databasen; `signInWithGoogle` gör resten.
 */
export interface GoogleEndpoints {
  authorization: string;
  token: string;
  jwks: string;
  issuers: readonly string[];
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  authorization: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  jwks: "https://www.googleapis.com/oauth2/v3/certs",
  // Google anger båda formerna i `iss` (https://developers.google.com/identity/openid-connect/openid-connect#validatinganidtoken).
  issuers: ["https://accounts.google.com", "accounts.google.com"]
};

export interface GoogleOidcConfig {
  clientId: string;
  clientSecret: string;
  /** `{O_TID_PUBLIC_ORIGIN}/api/account/google/callback`, exakt som i Google Cloud Console. */
  redirectUri: string;
  endpoints?: GoogleEndpoints;
}

/** Det som sparas i webbläsarens kortlivade kaka mellan start och återkomst. */
export interface GoogleLoginState {
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
}

/** Hur länge en påbörjad inloggning gäller. */
export const GOOGLE_LOGIN_STATE_LIFETIME_MS = 10 * 60 * 1000;
const RANDOM = /^[A-Za-z0-9_-]{43}$/;

const random = () => randomBytes(32).toString("base64url");

export function newGoogleLoginState(now = new Date()): GoogleLoginState {
  return { state: random(), nonce: random(), codeVerifier: random(), createdAt: now.getTime() };
}

/** PKCE S256: base64url(SHA-256(verifier)) (RFC 7636). */
export function pkceChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
}

export function googleAuthorizationUrl(config: GoogleOidcConfig, login: GoogleLoginState): string {
  const url = new URL((config.endpoints ?? GOOGLE_ENDPOINTS).authorization);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "openid email profile",
    state: login.state,
    nonce: login.nonce,
    code_challenge: pkceChallenge(login.codeVerifier),
    code_challenge_method: "S256",
    prompt: "select_account"
  }).toString();
  return url.href;
}

/** Kakans värde: base64url av JSON (bara tecken som får stå i en kaka). */
export function serializeGoogleLoginState(login: GoogleLoginState): string {
  return Buffer.from(JSON.stringify([login.state, login.nonce, login.codeVerifier, login.createdAt])).toString("base64url");
}

/** Kakans värde tillbaka, eller undefined om det är trasigt eller äldre än tio minuter. */
export function parseGoogleLoginState(value: string | null | undefined, now = new Date()): GoogleLoginState | undefined {
  if (!value || value.length > 400 || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); } catch { return undefined; }
  if (!Array.isArray(parsed) || parsed.length !== 4) return undefined;
  const [state, nonce, codeVerifier, createdAt] = parsed as unknown[];
  if (typeof state !== "string" || typeof nonce !== "string" || typeof codeVerifier !== "string" || typeof createdAt !== "number") return undefined;
  if (![state, nonce, codeVerifier].every(part => RANDOM.test(part))) return undefined;
  const age = now.getTime() - createdAt;
  if (!Number.isFinite(age) || age < -60_000 || age > GOOGLE_LOGIN_STATE_LIFETIME_MS) return undefined;
  return { state, nonce, codeVerifier, createdAt };
}

/** Jämför `state` från Google med kakans i konstant tid. */
export function sameState(expected: string, actual: string | null | undefined): boolean {
  if (!actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Personen enligt Googles ID-token. */
export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

export class GoogleOidcError extends Error {
  constructor(readonly code: "token-exchange" | "id-token" | "nonce") { super(`Google-inloggningen misslyckades (${code})`); }
}

const jwksCache = new Map<string, JWTVerifyGetKey>();
function remoteJwks(url: string): JWTVerifyGetKey {
  let keys = jwksCache.get(url);
  if (!keys) { keys = createRemoteJWKSet(new URL(url)); jwksCache.set(url, keys); }
  return keys;
}

export interface GoogleExchangeDependencies {
  fetch?: typeof fetch;
  /** Nycklarna att kontrollera ID-token mot (tester); annars Googles JWKS, hämtade och cachade av `jose`. */
  jwks?: JWTVerifyGetKey;
  now?: Date;
}

/**
 * Byter koden mot en ID-token (med PKCE-verifieraren och klientens hemlighet) och kontrollerar den: signaturen mot JWKS,
 * `iss`, `aud` (och `azp` när den finns), `exp`, `iat` och `nonce`. Kastar `GoogleOidcError` vid fel.
 */
export async function exchangeGoogleCode(config: GoogleOidcConfig, input: { code: string; login: GoogleLoginState },
  dependencies: GoogleExchangeDependencies = {}): Promise<GoogleIdentity> {
  const endpoints = config.endpoints ?? GOOGLE_ENDPOINTS;
  const send = dependencies.fetch ?? fetch;
  let idToken: unknown;
  try {
    const response = await send(endpoints.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: input.code, redirect_uri: config.redirectUri,
        client_id: config.clientId, client_secret: config.clientSecret, code_verifier: input.login.codeVerifier }).toString(),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new GoogleOidcError("token-exchange");
    idToken = ((await response.json()) as { id_token?: unknown }).id_token;
  } catch (error) {
    if (error instanceof GoogleOidcError) throw error;
    throw new GoogleOidcError("token-exchange");
  }
  if (typeof idToken !== "string" || idToken.length > 8192) throw new GoogleOidcError("id-token");
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(idToken, dependencies.jwks ?? remoteJwks(endpoints.jwks), {
      issuer: [...endpoints.issuers], audience: config.clientId, algorithms: ["RS256"], requiredClaims: ["sub", "exp", "iat"],
      clockTolerance: 60, ...(dependencies.now ? { currentDate: dependencies.now } : {})
    }));
  } catch (error) {
    if (error instanceof joseErrors.JOSEError) throw new GoogleOidcError("id-token");
    throw error;
  }
  if (payload.azp !== undefined && payload.azp !== config.clientId) throw new GoogleOidcError("id-token");
  if (typeof payload.nonce !== "string" || !sameState(input.login.nonce, payload.nonce)) throw new GoogleOidcError("nonce");
  return googleIdentityFromClaims(payload);
}

/** Personen ur ID-tokens påståenden (redan kontrollerade). `email_verified` måste vara sant för att adressen ska godtas. */
export function googleIdentityFromClaims(claims: Record<string, unknown>): GoogleIdentity {
  const { sub, email, email_verified: verified, name } = claims;
  if (typeof sub !== "string" || typeof email !== "string") throw new GoogleOidcError("id-token");
  return { sub, email, emailVerified: verified === true || verified === "true",
    ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}) };
}
