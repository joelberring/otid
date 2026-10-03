import {
  raceOverviewAdminErrorResponseSchema,
  type RaceOverviewAdminErrorCode
} from "@o-tid/contracts";
import {
  RACE_OVERVIEW_ADMIN_LOOPBACK_COOKIE_NAMES,
  RACE_OVERVIEW_ADMIN_PRODUCTION_COOKIE_NAMES,
  isRaceOverviewAdminLoopbackHostname,
  type RaceOverviewAdminCookieNames
} from "./race-overview-admin-cookies";

export const RACE_OVERVIEW_ADMIN_MAX_BODY_BYTES = 4 * 1024;
const SAFE_COOKIE_VALUE = /^[A-Za-z0-9._~-]+$/;

export const privateRaceOverviewAdminHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
} as const;

export interface RaceOverviewAdminSecurityPolicy {
  publicOrigin: string;
  cookieNames: RaceOverviewAdminCookieNames;
  secureCookies: boolean;
}

export interface RaceOverviewAdminSessionProof {
  sessionToken: string | null;
  csrfCookie: string | null;
  csrfHeader: string | null;
}

export class RaceOverviewAdminRequestError extends Error {}
export class RaceOverviewAdminConfigurationError extends Error {}

function parseConfiguredOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RaceOverviewAdminConfigurationError("O_TID_PUBLIC_ORIGIN är inte en giltig URL-origin");
  }
  if (value !== url.origin || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new RaceOverviewAdminConfigurationError("O_TID_PUBLIC_ORIGIN måste vara en exakt canonical origin");
  }
  return url;
}

export function raceOverviewAdminSecurityPolicy(
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env
): RaceOverviewAdminSecurityPolicy {
  const configuredOrigin = environment.O_TID_PUBLIC_ORIGIN;
  if (!configuredOrigin) throw new RaceOverviewAdminConfigurationError("O_TID_PUBLIC_ORIGIN saknas");
  const url = parseConfiguredOrigin(configuredOrigin);
  if (environment.NODE_ENV === "production") {
    if (url.protocol !== "https:") throw new RaceOverviewAdminConfigurationError("Produktion kräver HTTPS-origin");
    return {
      publicOrigin: url.origin,
      cookieNames: RACE_OVERVIEW_ADMIN_PRODUCTION_COOKIE_NAMES,
      secureCookies: true
    };
  }
  if (url.protocol !== "http:" || !isRaceOverviewAdminLoopbackHostname(url.hostname)) {
    throw new RaceOverviewAdminConfigurationError("Utvecklingspolicy tillåter endast explicit HTTP-loopback-origin");
  }
  return {
    publicOrigin: url.origin,
    cookieNames: RACE_OVERVIEW_ADMIN_LOOPBACK_COOKIE_NAMES,
    secureCookies: false
  };
}

export function hasExpectedRaceOverviewAdminOrigin(
  request: Request,
  policy: RaceOverviewAdminSecurityPolicy
): boolean {
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

export function raceOverviewAdminSessionProof(
  request: Request,
  policy: RaceOverviewAdminSecurityPolicy,
  requireCsrf: boolean
): RaceOverviewAdminSessionProof {
  return {
    sessionToken: readUniqueCookie(request, policy.cookieNames.session),
    csrfCookie: requireCsrf ? readUniqueCookie(request, policy.cookieNames.csrf) : null,
    csrfHeader: requireCsrf ? request.headers.get("x-otid-csrf") : null
  };
}

export async function readRaceOverviewAdminJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json") {
    throw new RaceOverviewAdminRequestError("Content-Type måste vara application/json");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) < 1 ||
      Number(declaredLength) > RACE_OVERVIEW_ADMIN_MAX_BODY_BYTES)) {
    throw new RaceOverviewAdminRequestError("Ogiltig bodylängd");
  }
  if (!request.body) throw new RaceOverviewAdminRequestError("Body saknas");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RACE_OVERVIEW_ADMIN_MAX_BODY_BYTES) {
        throw new RaceOverviewAdminRequestError("Bodyn är för stor");
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (length === 0) throw new RaceOverviewAdminRequestError("Body saknas");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new RaceOverviewAdminRequestError("Ogiltig JSON");
  }
}

export async function hasNoRaceOverviewAdminRequestBody(request: Request): Promise<boolean> {
  if (request.headers.get("content-type") !== null) return false;
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && contentLength !== "0") return false;
  if (request.body === null) return true;
  const reader = request.body.getReader();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return true;
      if (chunk.value.byteLength > 0) return false;
    }
  } finally {
    await reader.cancel();
  }
}

function cookieHeader(
  name: string,
  value: string,
  policy: RaceOverviewAdminSecurityPolicy,
  options: { httpOnly: boolean; expires: Date }
): string {
  if (!SAFE_COOKIE_VALUE.test(value)) throw new RaceOverviewAdminConfigurationError("Ogiltigt cookie-värde");
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    `Expires=${options.expires.toUTCString()}`,
    "SameSite=Strict"
  ];
  if (options.httpOnly) attributes.push("HttpOnly");
  if (policy.secureCookies) attributes.push("Secure");
  return attributes.join("; ");
}

export function setRaceOverviewAdminCookies(
  response: Response,
  policy: RaceOverviewAdminSecurityPolicy,
  values: { sessionToken: string; csrfToken: string; expiresAt: string }
): Response {
  const expires = new Date(values.expiresAt);
  if (!Number.isFinite(expires.getTime())) throw new RaceOverviewAdminConfigurationError("Ogiltig sessionsexpiry");
  response.headers.append("set-cookie", cookieHeader(policy.cookieNames.session, values.sessionToken, policy, {
    httpOnly: true,
    expires
  }));
  response.headers.append("set-cookie", cookieHeader(policy.cookieNames.csrf, values.csrfToken, policy, {
    httpOnly: false,
    expires
  }));
  return response;
}

export function clearRaceOverviewAdminCookies(
  response: Response,
  policy: RaceOverviewAdminSecurityPolicy
): Response {
  const expired = new Date(0);
  response.headers.append("set-cookie", cookieHeader(policy.cookieNames.session, "deleted", policy, {
    httpOnly: true,
    expires: expired
  }) + "; Max-Age=0");
  response.headers.append("set-cookie", cookieHeader(policy.cookieNames.csrf, "deleted", policy, {
    httpOnly: false,
    expires: expired
  }) + "; Max-Age=0");
  return response;
}

export function raceOverviewAdminJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privateRaceOverviewAdminHeaders });
}

export function raceOverviewAdminFailure(
  status: 400 | 401 | 403 | 404 | 500,
  error: RaceOverviewAdminErrorCode
): Response {
  return raceOverviewAdminJson(raceOverviewAdminErrorResponseSchema.parse({ formatVersion: 1, error }), status);
}
