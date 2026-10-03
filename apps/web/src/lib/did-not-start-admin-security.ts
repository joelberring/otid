import {
  didNotStartAdminErrorResponseSchema,
  type DidNotStartAdminErrorCode
} from "@o-tid/contracts";
import {
  DID_NOT_START_ADMIN_LOOPBACK_COOKIE_NAMES,
  DID_NOT_START_ADMIN_PRODUCTION_COOKIE_NAMES,
  isDidNotStartAdminLoopbackHostname,
  type DidNotStartAdminCookieNames
} from "./did-not-start-admin-cookies";

export const DID_NOT_START_ADMIN_MAX_BODY_BYTES = 4 * 1024;
const SAFE_COOKIE_VALUE = /^[A-Za-z0-9._~-]+$/;

export const privateDidNotStartAdminHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
} as const;

export interface DidNotStartAdminSecurityPolicy {
  publicOrigin: string;
  cookieNames: DidNotStartAdminCookieNames;
  secureCookies: boolean;
}

export interface DidNotStartAdminSessionProof {
  sessionToken: string | null;
  csrfCookie: string | null;
  csrfHeader: string | null;
}

export class DidNotStartAdminRequestError extends Error {}
export class DidNotStartAdminConfigurationError extends Error {}

function parseConfiguredOrigin(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch {
    throw new DidNotStartAdminConfigurationError("O_TID_PUBLIC_ORIGIN är inte en giltig URL-origin");
  }
  if (value !== url.origin || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new DidNotStartAdminConfigurationError("O_TID_PUBLIC_ORIGIN måste vara en exakt canonical origin");
  }
  return url;
}

export function didNotStartAdminSecurityPolicy(
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env
): DidNotStartAdminSecurityPolicy {
  const configuredOrigin = environment.O_TID_PUBLIC_ORIGIN;
  if (!configuredOrigin) throw new DidNotStartAdminConfigurationError("O_TID_PUBLIC_ORIGIN saknas");
  const url = parseConfiguredOrigin(configuredOrigin);
  if (environment.NODE_ENV === "production") {
    if (url.protocol !== "https:") throw new DidNotStartAdminConfigurationError("Produktion kräver HTTPS-origin");
    return { publicOrigin: url.origin, cookieNames: DID_NOT_START_ADMIN_PRODUCTION_COOKIE_NAMES, secureCookies: true };
  }
  if (url.protocol !== "http:" || !isDidNotStartAdminLoopbackHostname(url.hostname)) {
    throw new DidNotStartAdminConfigurationError("Utvecklingspolicy tillåter endast explicit HTTP-loopback-origin");
  }
  return { publicOrigin: url.origin, cookieNames: DID_NOT_START_ADMIN_LOOPBACK_COOKIE_NAMES, secureCookies: false };
}

export function hasExpectedDidNotStartAdminOrigin(request: Request, policy: DidNotStartAdminSecurityPolicy): boolean {
  return request.headers.get("origin") === policy.publicOrigin;
}

function readUniqueCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  let found: string | undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    if (found !== undefined) return null;
    const value = part.slice(separator + 1).trim();
    if (!value || !SAFE_COOKIE_VALUE.test(value)) return null;
    found = value;
  }
  return found ?? null;
}

export function didNotStartAdminSessionProof(
  request: Request,
  policy: DidNotStartAdminSecurityPolicy,
  requireCsrf: boolean
): DidNotStartAdminSessionProof {
  return {
    sessionToken: readUniqueCookie(request, policy.cookieNames.session),
    csrfCookie: requireCsrf ? readUniqueCookie(request, policy.cookieNames.csrf) : null,
    csrfHeader: requireCsrf ? request.headers.get("x-otid-csrf") : null
  };
}

export async function readDidNotStartAdminJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json") {
    throw new DidNotStartAdminRequestError("Content-Type måste vara application/json");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null &&
      (!/^\d+$/.test(declaredLength) || Number(declaredLength) < 1 || Number(declaredLength) > DID_NOT_START_ADMIN_MAX_BODY_BYTES)) {
    throw new DidNotStartAdminRequestError("Ogiltig bodylängd");
  }
  if (!request.body) throw new DidNotStartAdminRequestError("Body saknas");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > DID_NOT_START_ADMIN_MAX_BODY_BYTES) throw new DidNotStartAdminRequestError("Bodyn är för stor");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (length === 0) throw new DidNotStartAdminRequestError("Body saknas");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new DidNotStartAdminRequestError("Ogiltig JSON"); }
}

export async function hasNoDidNotStartAdminRequestBody(request: Request): Promise<boolean> {
  if (request.headers.get("content-type") !== null) return false;
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && contentLength !== "0") return false;
  if (request.body === null) return true;
  const reader = request.body.getReader();
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) return true; if (chunk.value.byteLength > 0) return false; }
  } finally { await reader.cancel(); }
}

function safeCookieValue(value: string): string {
  if (!SAFE_COOKIE_VALUE.test(value)) throw new DidNotStartAdminConfigurationError("Ogiltigt cookie-värde");
  return value;
}

function cookieHeader(name: string, value: string, policy: DidNotStartAdminSecurityPolicy, options: { httpOnly: boolean; expires: Date }): string {
  const attributes = [`${name}=${safeCookieValue(value)}`, "Path=/", `Expires=${options.expires.toUTCString()}`, "SameSite=Strict"];
  if (options.httpOnly) attributes.push("HttpOnly");
  if (policy.secureCookies) attributes.push("Secure");
  return attributes.join("; ");
}

export function setDidNotStartAdminCookies(response: Response, policy: DidNotStartAdminSecurityPolicy,
  values: { sessionToken: string; csrfToken: string; expiresAt: string }): Response {
  const expires = new Date(values.expiresAt);
  if (!Number.isFinite(expires.getTime())) throw new DidNotStartAdminConfigurationError("Ogiltig sessionsexpiry");
  response.headers.append("set-cookie", cookieHeader(policy.cookieNames.session, values.sessionToken, policy, { httpOnly: true, expires }));
  response.headers.append("set-cookie", cookieHeader(policy.cookieNames.csrf, values.csrfToken, policy, { httpOnly: false, expires }));
  return response;
}

export function clearDidNotStartAdminCookies(response: Response, policy: DidNotStartAdminSecurityPolicy): Response {
  const expired = new Date(0);
  response.headers.append("set-cookie", `${cookieHeader(policy.cookieNames.session, "deleted", policy, { httpOnly: true, expires: expired })}; Max-Age=0`);
  response.headers.append("set-cookie", `${cookieHeader(policy.cookieNames.csrf, "deleted", policy, { httpOnly: false, expires: expired })}; Max-Age=0`);
  return response;
}

export function didNotStartAdminJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privateDidNotStartAdminHeaders });
}

export function didNotStartAdminFailure(status: 400 | 401 | 403 | 404 | 409 | 413 | 500, code: DidNotStartAdminErrorCode): Response {
  return didNotStartAdminJson(didNotStartAdminErrorResponseSchema.parse({ formatVersion: 1, error: code }), status);
}
