import {
  IOF_IMPORT_CONTENT_TYPE,
  IOF_IMPORT_MAX_BYTES,
  UUID_SOURCE,
  accountErrorResponseSchema,
  entryClassAdminErrorResponseSchema,
  eventCreationErrorResponseSchema,
  iofImportErrorResponseSchema,
  iofResultListExportAdminErrorResponseSchema,
  type AccountErrorCode,
  type EntryClassAdminErrorCode,
  type EventCreationErrorCode,
  type IofImportErrorCode,
  type IofResultListExportAdminErrorCode
} from "@o-tid/contracts";
import {
  ORGANIZER_ACCOUNT_LOOPBACK_COOKIES,
  ORGANIZER_ACCOUNT_PRODUCTION_COOKIES,
  isOrganizerLoopback,
  type OrganizerAccountCookieNames
} from "./organizer-account-cookies";

/**
 * Den enda säkerhetspolicyn för arrangörens anrop (steg 23): exakt origin, kontots sessionskaka och CSRF-par,
 * begränsade bodyläsare, kakor och privata svar. Alla adminroutes, kontots routes och importen använder den.
 */
export const JSON_MAX_BODY_BYTES = 4 * 1024;
const COOKIE_VALUE = /^[A-Za-z0-9._~-]+$/;
const SESSION_TOKEN = new RegExp(`^otid_user_session_v1\\.${UUID_SOURCE}\\.[A-Za-z0-9_-]{43}$`);
const CSRF_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const privateHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
} as const;

export interface SecurityPolicy {
  publicOrigin: string;
  cookieNames: OrganizerAccountCookieNames;
  secureCookies: boolean;
}

export interface SessionProof {
  sessionToken: string | null;
  csrfCookie: string | null;
  csrfHeader: string | null;
  requireCsrf?: boolean;
}

export interface AcceptedIofImportBody {
  bytes: Uint8Array;
  xml: string;
}

export class SecurityConfigurationError extends Error {}
export class RequestBodyError extends Error {}

function exactOrigin(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new SecurityConfigurationError("O_TID_PUBLIC_ORIGIN är inte en giltig URL-origin"); }
  if (url.origin !== value || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new SecurityConfigurationError("O_TID_PUBLIC_ORIGIN måste vara en exakt canonical origin");
  }
  return url;
}

export function securityPolicy(
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env
): SecurityPolicy {
  if (!environment.O_TID_PUBLIC_ORIGIN) throw new SecurityConfigurationError("O_TID_PUBLIC_ORIGIN saknas");
  const url = exactOrigin(environment.O_TID_PUBLIC_ORIGIN);
  if (environment.NODE_ENV === "production") {
    if (url.protocol !== "https:") throw new SecurityConfigurationError("Produktion kräver HTTPS-origin");
    return { publicOrigin: url.origin, cookieNames: ORGANIZER_ACCOUNT_PRODUCTION_COOKIES, secureCookies: true };
  }
  if (url.protocol !== "http:" || !isOrganizerLoopback(url.hostname)) {
    throw new SecurityConfigurationError("Utvecklingspolicy tillåter endast explicit HTTP-loopback-origin");
  }
  return { publicOrigin: url.origin, cookieNames: ORGANIZER_ACCOUNT_LOOPBACK_COOKIES, secureCookies: false };
}

export function hasExpectedOrigin(request: Request, policy: SecurityPolicy): boolean {
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

/** Kontots sessionskaka och, för en skrivning, CSRF-kakan och rubriken x-otid-csrf. */
export function sessionProof(request: Request, policy: SecurityPolicy, requireCsrf: boolean): SessionProof {
  return {
    sessionToken: readUniqueCookie(request, policy.cookieNames.session),
    csrfCookie: requireCsrf ? readUniqueCookie(request, policy.cookieNames.csrf) : null,
    csrfHeader: requireCsrf ? request.headers.get("x-otid-csrf") : null,
    ...(requireCsrf ? { requireCsrf: true } : {})
  };
}

export function validDeclaredLength(request: Request, maximum: number): boolean {
  const value = request.headers.get("content-length");
  return value === null || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= maximum);
}

export async function readBoundedBytes(request: Request, limit: number): Promise<Uint8Array> {
  if (!request.body) throw new RequestBodyError("Body saknas");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new RequestBodyError("Bodyn är för stor");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (length === 0) throw new RequestBodyError("Body saknas");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** En JSON-body på högst `maxBytes` (4 KiB, 8 KiB för identitetsändringar). */
export async function readJsonBody(request: Request, maxBytes = JSON_MAX_BODY_BYTES): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json") {
    throw new RequestBodyError("Content-Type måste vara application/json");
  }
  if (!validDeclaredLength(request, maxBytes)) throw new RequestBodyError("Ogiltig bodylängd");
  const bytes = await readBoundedBytes(request, maxBytes);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new RequestBodyError("Ogiltig JSON"); }
}

export async function readIofImportBody(request: Request): Promise<AcceptedIofImportBody> {
  if (request.headers.get("content-type") !== IOF_IMPORT_CONTENT_TYPE || !validDeclaredLength(request, IOF_IMPORT_MAX_BYTES)) {
    throw new RequestBodyError("Ogiltig XML-request");
  }
  const bytes = await readBoundedBytes(request, IOF_IMPORT_MAX_BYTES);
  try { return { bytes, xml: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }; }
  catch { throw new RequestBodyError("XML måste vara strikt UTF-8"); }
}

export async function hasNoRequestBody(request: Request): Promise<boolean> {
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

function cookie(name: string, value: string, policy: SecurityPolicy, expiresAt: string, httpOnly: boolean): string {
  const expires = new Date(expiresAt);
  if (!COOKIE_VALUE.test(value) || !Number.isFinite(expires.getTime())) throw new SecurityConfigurationError("Ogiltig kaka");
  const attributes = [`${name}=${value}`, "Path=/", `Expires=${expires.toUTCString()}`, "SameSite=Strict"];
  if (httpOnly) attributes.push("HttpOnly");
  if (policy.secureCookies) attributes.push("Secure");
  return attributes.join("; ");
}

/** Sätter kontots sessionskaka (HttpOnly) och CSRF-kaka; värdena måste ha kontosessionens format. */
export function setSessionCookies(response: Response, policy: SecurityPolicy, values: {
  sessionToken: string; csrfToken: string; expiresAt: string
}): Response {
  if (!SESSION_TOKEN.test(values.sessionToken) || !CSRF_TOKEN.test(values.csrfToken)) {
    throw new SecurityConfigurationError("Ogiltig session");
  }
  response.headers.append("set-cookie", cookie(policy.cookieNames.session, values.sessionToken, policy, values.expiresAt, true));
  response.headers.append("set-cookie", cookie(policy.cookieNames.csrf, values.csrfToken, policy, values.expiresAt, false));
  return response;
}

export function clearSessionCookies(response: Response, policy: SecurityPolicy): Response {
  const expired = "Thu, 01 Jan 1970 00:00:00 GMT";
  for (const name of [policy.cookieNames.session, policy.cookieNames.csrf]) {
    const attributes = [`${name}=deleted`, "Path=/", `Expires=${expired}`, "Max-Age=0", "SameSite=Strict"];
    if (name === policy.cookieNames.session) attributes.push("HttpOnly");
    if (policy.secureCookies) attributes.push("Secure");
    response.headers.append("set-cookie", attributes.join("; "));
  }
  return response;
}

export function privateJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privateHeaders });
}

/** Fel från tävlingens adminroutes. */
export function adminFailure(status: 400 | 401 | 403 | 404 | 409 | 500, code: EntryClassAdminErrorCode): Response {
  return privateJson(entryClassAdminErrorResponseSchema.parse({ formatVersion: 1, error: code }), status);
}

/** Fel från IOF-importen, med högst 50 korta förklaringar. */
export function importFailure(status: 400 | 401 | 403 | 409 | 422 | 500, code: IofImportErrorCode, issues?: readonly string[]): Response {
  return privateJson(iofImportErrorResponseSchema.parse({ formatVersion: 1, error: code,
    ...(issues && issues.length > 0 ? { issues: issues.slice(0, 50).map(issue => issue.slice(0, 500)) } : {}) }), status);
}

/** Fel från IOF-resultatexporten. */
export function resultExportFailure(
  status: 400 | 401 | 403 | 404 | 409 | 413 | 500,
  error: IofResultListExportAdminErrorCode
): Response {
  return privateJson(iofResultListExportAdminErrorResponseSchema.parse({ formatVersion: 1, error }), status);
}

/** Fel från arrangörens egna anrop (event och tävlingar). */
export function organizerFailure(status: 400 | 401 | 403 | 404 | 409 | 500, error: EventCreationErrorCode): Response {
  return privateJson(eventCreationErrorResponseSchema.parse({ formatVersion: 1, error }), status);
}

/** Fel från kontots egna anrop (ADR-0172): också spärr, spärrat konto, e-post avstängd och fel bekräftelse. */
export function accountFailure(status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503, error: AccountErrorCode): Response {
  return privateJson(accountErrorResponseSchema.parse({ formatVersion: 1, error }), status);
}

/**
 * Klientens adress för spärren mot upprepade försök. I drift sätter Caddy X-Forwarded-For till klientens
 * adress (inkommande värden från klienten litar Caddy inte på), och Next nås bara via Caddy.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "okänd";
}
