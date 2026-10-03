import {
  resultRecalculationAdminErrorResponseSchema,
  type ResultRecalculationAdminErrorCode
} from "@o-tid/contracts";
import {
  RESULT_RECALCULATION_ADMIN_LOOPBACK_COOKIE_NAMES,
  RESULT_RECALCULATION_ADMIN_PRODUCTION_COOKIE_NAMES,
  isResultRecalculationAdminLoopbackHostname,
  type ResultRecalculationAdminCookieNames
} from "./result-recalculation-admin-cookies";

export const RESULT_RECALCULATION_ADMIN_MAX_BODY_BYTES = 4 * 1024;

const SAFE_COOKIE_VALUE = /^[A-Za-z0-9._~-]+$/;

export const privateResultRecalculationAdminHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
} as const;

export interface ResultRecalculationAdminSecurityPolicy {
  publicOrigin: string;
  cookieNames: ResultRecalculationAdminCookieNames;
  secureCookies: boolean;
}

export interface ResultRecalculationAdminSessionProof {
  sessionToken: string | null;
  csrfCookie: string | null;
  csrfHeader: string | null;
}

export class ResultRecalculationAdminRequestError extends Error {}
export class ResultRecalculationAdminConfigurationError extends Error {}

function parseConfiguredOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ResultRecalculationAdminConfigurationError("O_TID_PUBLIC_ORIGIN är inte en giltig URL-origin");
  }
  if (value !== url.origin || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new ResultRecalculationAdminConfigurationError("O_TID_PUBLIC_ORIGIN måste vara en exakt canonical origin");
  }
  return url;
}

export function resultRecalculationAdminSecurityPolicy(
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env
): ResultRecalculationAdminSecurityPolicy {
  const configuredOrigin = environment.O_TID_PUBLIC_ORIGIN;
  if (!configuredOrigin) throw new ResultRecalculationAdminConfigurationError("O_TID_PUBLIC_ORIGIN saknas");
  const url = parseConfiguredOrigin(configuredOrigin);
  if (environment.NODE_ENV === "production") {
    if (url.protocol !== "https:") throw new ResultRecalculationAdminConfigurationError("Produktion kräver HTTPS-origin");
    return {
      publicOrigin: url.origin,
      cookieNames: RESULT_RECALCULATION_ADMIN_PRODUCTION_COOKIE_NAMES,
      secureCookies: true
    };
  }
  if (url.protocol !== "http:" || !isResultRecalculationAdminLoopbackHostname(url.hostname)) {
    throw new ResultRecalculationAdminConfigurationError("Utvecklingspolicy tillåter endast explicit HTTP-loopback-origin");
  }
  return {
    publicOrigin: url.origin,
    cookieNames: RESULT_RECALCULATION_ADMIN_LOOPBACK_COOKIE_NAMES,
    secureCookies: false
  };
}

export function hasExpectedResultRecalculationAdminOrigin(
  request: Request,
  policy: ResultRecalculationAdminSecurityPolicy
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

export function resultRecalculationAdminSessionProof(
  request: Request,
  policy: ResultRecalculationAdminSecurityPolicy,
  requireCsrf: boolean
): ResultRecalculationAdminSessionProof {
  return {
    sessionToken: readUniqueCookie(request, policy.cookieNames.session),
    csrfCookie: requireCsrf ? readUniqueCookie(request, policy.cookieNames.csrf) : null,
    csrfHeader: requireCsrf ? request.headers.get("x-otid-csrf") : null
  };
}

export async function readResultRecalculationAdminJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json") {
    throw new ResultRecalculationAdminRequestError("Content-Type måste vara application/json");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null &&
      (!/^\d+$/.test(declaredLength) || Number(declaredLength) < 1 ||
        Number(declaredLength) > RESULT_RECALCULATION_ADMIN_MAX_BODY_BYTES)) {
    throw new ResultRecalculationAdminRequestError("Ogiltig bodylängd");
  }
  if (!request.body) throw new ResultRecalculationAdminRequestError("Body saknas");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RESULT_RECALCULATION_ADMIN_MAX_BODY_BYTES) {
        throw new ResultRecalculationAdminRequestError("Bodyn är för stor");
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (length === 0) throw new ResultRecalculationAdminRequestError("Body saknas");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ResultRecalculationAdminRequestError("Ogiltig JSON");
  }
}

export async function hasNoResultRecalculationAdminRequestBody(request: Request): Promise<boolean> {
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

function safeCookieValue(value: string): string {
  if (!SAFE_COOKIE_VALUE.test(value)) {
    throw new ResultRecalculationAdminConfigurationError("Ogiltigt cookie-värde");
  }
  return value;
}

function cookieHeader(
  name: string,
  value: string,
  policy: ResultRecalculationAdminSecurityPolicy,
  options: { httpOnly: boolean; expires: Date }
): string {
  const attributes = [
    `${name}=${safeCookieValue(value)}`,
    "Path=/",
    `Expires=${options.expires.toUTCString()}`,
    "SameSite=Strict"
  ];
  if (options.httpOnly) attributes.push("HttpOnly");
  if (policy.secureCookies) attributes.push("Secure");
  return attributes.join("; ");
}

export function setResultRecalculationAdminCookies(
  response: Response,
  policy: ResultRecalculationAdminSecurityPolicy,
  values: { sessionToken: string; csrfToken: string; expiresAt: string }
): Response {
  const expires = new Date(values.expiresAt);
  if (!Number.isFinite(expires.getTime())) {
    throw new ResultRecalculationAdminConfigurationError("Ogiltig sessionsexpiry");
  }
  response.headers.append("set-cookie", cookieHeader(
    policy.cookieNames.session,
    values.sessionToken,
    policy,
    { httpOnly: true, expires }
  ));
  response.headers.append("set-cookie", cookieHeader(
    policy.cookieNames.csrf,
    values.csrfToken,
    policy,
    { httpOnly: false, expires }
  ));
  return response;
}

export function clearResultRecalculationAdminCookies(
  response: Response,
  policy: ResultRecalculationAdminSecurityPolicy
): Response {
  const expired = new Date(0);
  response.headers.append("set-cookie", `${cookieHeader(
    policy.cookieNames.session,
    "deleted",
    policy,
    { httpOnly: true, expires: expired }
  )}; Max-Age=0`);
  response.headers.append("set-cookie", `${cookieHeader(
    policy.cookieNames.csrf,
    "deleted",
    policy,
    { httpOnly: false, expires: expired }
  )}; Max-Age=0`);
  return response;
}

export function resultRecalculationAdminJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privateResultRecalculationAdminHeaders });
}

export function resultRecalculationAdminFailure(
  status: 400 | 401 | 403 | 404 | 409 | 500,
  code: ResultRecalculationAdminErrorCode
): Response {
  return resultRecalculationAdminJson(
    resultRecalculationAdminErrorResponseSchema.parse({ formatVersion: 1, error: code }),
    status
  );
}
