import {
  accountErrorResponseSchema,
  eventCreationErrorResponseSchema,
  type AccountErrorCode,
  type EventCreationErrorCode
} from "@o-tid/contracts";
import {
  ORGANIZER_ACCOUNT_LOOPBACK_COOKIES,
  ORGANIZER_ACCOUNT_PRODUCTION_COOKIES,
  isOrganizerLoopback,
  type OrganizerAccountCookieNames
} from "./organizer-account-cookies";
import {
  RACE_ADMINISTRATOR_LOOPBACK_COOKIES,
  RACE_ADMINISTRATOR_PRODUCTION_COOKIES
} from "./race-administrator-cookies";

export const ORGANIZER_MAX_BODY_BYTES = 4 * 1024;
const COOKIE_VALUE = /^[A-Za-z0-9._~-]+$/;

export const privateOrganizerHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
} as const;

export interface OrganizerSecurityPolicy {
  publicOrigin: string;
  cookieNames: OrganizerAccountCookieNames;
  raceCookieNames: typeof RACE_ADMINISTRATOR_LOOPBACK_COOKIES | typeof RACE_ADMINISTRATOR_PRODUCTION_COOKIES;
  secureCookies: boolean;
}

export interface OrganizerSessionProof {
  sessionToken: string | null;
  csrfCookie: string | null;
  csrfHeader: string | null;
  requireCsrf?: boolean;
}

export class OrganizerConfigurationError extends Error {}
export class OrganizerRequestError extends Error {}

function exactOrigin(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new OrganizerConfigurationError(); }
  if (url.origin !== value || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new OrganizerConfigurationError();
  }
  return url;
}

export function organizerSecurityPolicy(
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env
): OrganizerSecurityPolicy {
  if (!environment.O_TID_PUBLIC_ORIGIN) throw new OrganizerConfigurationError();
  const url = exactOrigin(environment.O_TID_PUBLIC_ORIGIN);
  if (environment.NODE_ENV === "production") {
    if (url.protocol !== "https:") throw new OrganizerConfigurationError();
    return { publicOrigin: url.origin, cookieNames: ORGANIZER_ACCOUNT_PRODUCTION_COOKIES,
      raceCookieNames: RACE_ADMINISTRATOR_PRODUCTION_COOKIES, secureCookies: true };
  }
  if (url.protocol !== "http:" || !isOrganizerLoopback(url.hostname)) throw new OrganizerConfigurationError();
  return { publicOrigin: url.origin, cookieNames: ORGANIZER_ACCOUNT_LOOPBACK_COOKIES,
    raceCookieNames: RACE_ADMINISTRATOR_LOOPBACK_COOKIES, secureCookies: false };
}

export function hasExpectedOrganizerOrigin(request: Request, policy: OrganizerSecurityPolicy): boolean {
  return request.headers.get("origin") === policy.publicOrigin;
}

function readUniqueCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  let found: string | null = null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    if (found !== null) return null;
    const value = part.slice(separator + 1).trim();
    if (!value || !COOKIE_VALUE.test(value)) return null;
    found = value;
  }
  return found;
}

export function organizerSessionProof(
  request: Request,
  policy: OrganizerSecurityPolicy,
  requireCsrf: boolean
): OrganizerSessionProof {
  return {
    sessionToken: readUniqueCookie(request, policy.cookieNames.session),
    csrfCookie: requireCsrf ? readUniqueCookie(request, policy.cookieNames.csrf) : null,
    csrfHeader: requireCsrf ? request.headers.get("x-otid-csrf") : null,
    ...(requireCsrf ? { requireCsrf: true } : {})
  };
}

export async function readOrganizerJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json") throw new OrganizerRequestError();
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) < 1 || Number(declared) > ORGANIZER_MAX_BODY_BYTES)) {
    throw new OrganizerRequestError();
  }
  if (!request.body) throw new OrganizerRequestError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ORGANIZER_MAX_BODY_BYTES) throw new OrganizerRequestError();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (size === 0) throw new OrganizerRequestError();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new OrganizerRequestError(); }
}

export async function hasNoOrganizerRequestBody(request: Request): Promise<boolean> {
  if (request.headers.get("content-type") !== null) return false;
  const length = request.headers.get("content-length");
  if (length !== null && length !== "0") return false;
  if (!request.body) return true;
  const reader = request.body.getReader();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return true;
      if (chunk.value.byteLength > 0) return false;
    }
  } finally { await reader.cancel(); }
}

function cookie(name: string, value: string, policy: OrganizerSecurityPolicy, expiresAt: string, httpOnly: boolean): string {
  const expires = new Date(expiresAt);
  if (!COOKIE_VALUE.test(value) || !Number.isFinite(expires.getTime())) throw new OrganizerConfigurationError();
  const attributes = [`${name}=${value}`, "Path=/", `Expires=${expires.toUTCString()}`, "SameSite=Strict"];
  if (httpOnly) attributes.push("HttpOnly");
  if (policy.secureCookies) attributes.push("Secure");
  return attributes.join("; ");
}

function addCookies(response: Response, policy: OrganizerSecurityPolicy, names: OrganizerAccountCookieNames | OrganizerSecurityPolicy["raceCookieNames"], values: {
  sessionToken: string; csrfToken: string; expiresAt: string
}): Response {
  response.headers.append("set-cookie", cookie(names.session, values.sessionToken, policy, values.expiresAt, true));
  response.headers.append("set-cookie", cookie(names.csrf, values.csrfToken, policy, values.expiresAt, false));
  return response;
}

function clearCookies(response: Response, policy: OrganizerSecurityPolicy, names: OrganizerAccountCookieNames | OrganizerSecurityPolicy["raceCookieNames"]): Response {
  const expired = "Thu, 01 Jan 1970 00:00:00 GMT";
  for (const name of [names.session, names.csrf]) {
    const attributes = [`${name}=deleted`, "Path=/", `Expires=${expired}`, "Max-Age=0", "SameSite=Strict"];
    if (name === names.session) attributes.push("HttpOnly");
    if (policy.secureCookies) attributes.push("Secure");
    response.headers.append("set-cookie", attributes.join("; "));
  }
  return response;
}

export const setOrganizerAccountCookies = (response: Response, policy: OrganizerSecurityPolicy, values: {
  sessionToken: string; csrfToken: string; expiresAt: string
}) => {
  if (!/^otid_user_session_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/.test(values.sessionToken) ||
    !/^[A-Za-z0-9_-]{43}$/.test(values.csrfToken)) throw new OrganizerConfigurationError();
  return addCookies(response, policy, policy.cookieNames, values);
};
export const setOrganizerRaceCookies = (response: Response, policy: OrganizerSecurityPolicy, values: {
  sessionToken: string; csrfToken: string; expiresAt: string
}) => {
  if (!/^otid_org_session_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/.test(values.sessionToken) ||
    !/^[A-Za-z0-9_-]{43}$/.test(values.csrfToken)) throw new OrganizerConfigurationError();
  return addCookies(response, policy, policy.raceCookieNames, values);
};
export const clearOrganizerAccountCookies = (response: Response, policy: OrganizerSecurityPolicy) => clearCookies(response, policy, policy.cookieNames);

export function organizerJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privateOrganizerHeaders });
}

export function organizerFailure(status: 400 | 401 | 403 | 404 | 409 | 500, error: EventCreationErrorCode): Response {
  return organizerJson(eventCreationErrorResponseSchema.parse({ formatVersion: 1, error }), status);
}

/** Fel från kontots egna anrop (ADR-0172): också spärr, spärrat konto, e-post avstängd och fel bekräftelse. */
export function accountFailure(status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503, error: AccountErrorCode): Response {
  return organizerJson(accountErrorResponseSchema.parse({ formatVersion: 1, error }), status);
}

/**
 * Klientens adress för spärren mot upprepade försök. I drift sätter Caddy X-Forwarded-For till klientens
 * adress (inkommande värden från klienten litar Caddy inte på), och Next nås bara via Caddy.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "okänd";
}
