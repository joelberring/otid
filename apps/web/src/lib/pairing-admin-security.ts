import {
  PAIRING_ADMIN_LOOPBACK_COOKIE_NAMES,
  PAIRING_ADMIN_PRODUCTION_COOKIE_NAMES,
  isPairingAdminLoopbackHostname,
  type PairingAdminCookieNames
} from "./pairing-admin-cookies";

const MAX_BODY_BYTES = 4 * 1024;
const SAFE_COOKIE_VALUE = /^[A-Za-z0-9._~-]+$/;

export const privatePairingAdminHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
} as const;

export interface PairingAdminSecurityPolicy {
  publicOrigin: string;
  cookieNames: PairingAdminCookieNames;
  secureCookies: boolean;
}

export interface PairingAdminSessionProof {
  sessionToken: string | null;
  csrfCookie: string | null;
  csrfHeader: string | null;
}

export class PairingAdminRequestError extends Error {}
export class PairingAdminConfigurationError extends Error {}

function parseConfiguredOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PairingAdminConfigurationError("O_TID_PUBLIC_ORIGIN är inte en giltig URL-origin");
  }
  if (value !== url.origin || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new PairingAdminConfigurationError("O_TID_PUBLIC_ORIGIN måste vara en exakt canonical origin");
  }
  return url;
}

export function pairingAdminSecurityPolicy(
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env
): PairingAdminSecurityPolicy {
  const configuredOrigin = environment.O_TID_PUBLIC_ORIGIN;
  if (!configuredOrigin) {
    throw new PairingAdminConfigurationError("O_TID_PUBLIC_ORIGIN saknas");
  }
  const url = parseConfiguredOrigin(configuredOrigin);
  if (environment.NODE_ENV === "production") {
    if (url.protocol !== "https:") {
      throw new PairingAdminConfigurationError("Produktion kräver HTTPS-origin");
    }
    return {
      publicOrigin: url.origin,
      cookieNames: PAIRING_ADMIN_PRODUCTION_COOKIE_NAMES,
      secureCookies: true
    };
  }
  if (url.protocol !== "http:" || !isPairingAdminLoopbackHostname(url.hostname)) {
    throw new PairingAdminConfigurationError("Utvecklingspolicy tillåter endast explicit HTTP-loopback-origin");
  }
  return {
    publicOrigin: url.origin,
    cookieNames: PAIRING_ADMIN_LOOPBACK_COOKIE_NAMES,
    secureCookies: false
  };
}

export function hasExpectedPairingAdminOrigin(request: Request, policy: PairingAdminSecurityPolicy): boolean {
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

export function pairingAdminSessionProof(
  request: Request,
  policy: PairingAdminSecurityPolicy,
  requireCsrf: boolean
): PairingAdminSessionProof {
  return {
    sessionToken: readUniqueCookie(request, policy.cookieNames.session),
    csrfCookie: requireCsrf ? readUniqueCookie(request, policy.cookieNames.csrf) : null,
    csrfHeader: requireCsrf ? request.headers.get("x-otid-csrf") : null
  };
}

export async function readPairingAdminJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json") {
    throw new PairingAdminRequestError("Content-Type måste vara application/json");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
    throw new PairingAdminRequestError("Ogiltig bodylängd");
  }
  if (!request.body) throw new PairingAdminRequestError("Body saknas");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new PairingAdminRequestError("Bodyn är för stor");
    }
    chunks.push(value);
  }
  if (length === 0) throw new PairingAdminRequestError("Body saknas");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new PairingAdminRequestError("Ogiltig JSON");
  }
}

export async function hasNoRequestBody(request: Request): Promise<boolean> {
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
  if (!SAFE_COOKIE_VALUE.test(value)) throw new PairingAdminConfigurationError("Ogiltigt cookie-värde");
  return value;
}

function cookieHeader(
  name: string,
  value: string,
  policy: PairingAdminSecurityPolicy,
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

export function setPairingAdminCookies(
  response: Response,
  policy: PairingAdminSecurityPolicy,
  values: { sessionToken: string; csrfToken: string; expiresAt: string }
): Response {
  const expires = new Date(values.expiresAt);
  if (!Number.isFinite(expires.getTime())) throw new PairingAdminConfigurationError("Ogiltig sessionsexpiry");
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

export function clearPairingAdminCookies(response: Response, policy: PairingAdminSecurityPolicy): Response {
  const expired = new Date(0);
  response.headers.append("set-cookie", cookieHeader(
    policy.cookieNames.session,
    "deleted",
    policy,
    { httpOnly: true, expires: expired }
  ) + "; Max-Age=0");
  response.headers.append("set-cookie", cookieHeader(
    policy.cookieNames.csrf,
    "deleted",
    policy,
    { httpOnly: false, expires: expired }
  ) + "; Max-Age=0");
  return response;
}

export function pairingAdminJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privatePairingAdminHeaders });
}

export function pairingAdminFailure(status: 400 | 401 | 403 | 404 | 409 | 500 | 503): Response {
  return pairingAdminJson({ error: "Pairingadministrationen kunde inte genomföras" }, status);
}
