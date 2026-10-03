import {
  readoutResultHistoryAdminErrorResponseSchema,
  type ReadoutResultHistoryAdminErrorCode
} from "@o-tid/contracts";

const PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-readout-result-history-session",
  csrf: "__Host-otid-readout-result-history-csrf"
} as const;
const LOOPBACK_COOKIE_NAMES = {
  session: "otid_readout_result_history_session",
  csrf: "otid_readout_result_history_csrf"
} as const;
const MAX_BODY_BYTES = 4 * 1024;
const SAFE_COOKIE_VALUE = /^[A-Za-z0-9._~-]+$/;

export const privateReadoutResultHistoryAdminHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
} as const;

type CookieNames = typeof PRODUCTION_COOKIE_NAMES | typeof LOOPBACK_COOKIE_NAMES;
export interface ReadoutResultHistoryAdminSecurityPolicy {
  publicOrigin: string;
  cookieNames: CookieNames;
  secureCookies: boolean;
}

export class ReadoutResultHistoryAdminConfigurationError extends Error {}
export class ReadoutResultHistoryAdminRequestError extends Error {}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function readoutResultHistoryAdminSecurityPolicy(
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env
): ReadoutResultHistoryAdminSecurityPolicy {
  const configured = environment.O_TID_PUBLIC_ORIGIN;
  if (!configured) throw new ReadoutResultHistoryAdminConfigurationError("O_TID_PUBLIC_ORIGIN saknas");
  let url: URL;
  try { url = new URL(configured); } catch {
    throw new ReadoutResultHistoryAdminConfigurationError("O_TID_PUBLIC_ORIGIN är ogiltig");
  }
  if (configured !== url.origin || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new ReadoutResultHistoryAdminConfigurationError("O_TID_PUBLIC_ORIGIN måste vara canonical");
  }
  if (environment.NODE_ENV === "production") {
    if (url.protocol !== "https:") throw new ReadoutResultHistoryAdminConfigurationError("Produktion kräver HTTPS");
    return { publicOrigin: url.origin, cookieNames: PRODUCTION_COOKIE_NAMES, secureCookies: true };
  }
  if (url.protocol !== "http:" || !isLoopback(url.hostname)) {
    throw new ReadoutResultHistoryAdminConfigurationError("Utveckling kräver HTTP-loopback");
  }
  return { publicOrigin: url.origin, cookieNames: LOOPBACK_COOKIE_NAMES, secureCookies: false };
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

export function readoutResultHistoryAdminSessionProof(
  request: Request,
  policy: ReadoutResultHistoryAdminSecurityPolicy,
  requireCsrf: boolean
) {
  return {
    sessionToken: readUniqueCookie(request, policy.cookieNames.session),
    csrfCookie: requireCsrf ? readUniqueCookie(request, policy.cookieNames.csrf) : null,
    csrfHeader: requireCsrf ? request.headers.get("x-otid-csrf") : null
  };
}

export function hasExpectedReadoutResultHistoryAdminOrigin(
  request: Request,
  policy: ReadoutResultHistoryAdminSecurityPolicy
): boolean {
  return request.headers.get("origin") === policy.publicOrigin;
}

export async function readReadoutResultHistoryAdminJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json") throw new ReadoutResultHistoryAdminRequestError();
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) < 1 || Number(declared) > MAX_BODY_BYTES)) {
    throw new ReadoutResultHistoryAdminRequestError();
  }
  if (!request.body) throw new ReadoutResultHistoryAdminRequestError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_BODY_BYTES) throw new ReadoutResultHistoryAdminRequestError();
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (length === 0) throw new ReadoutResultHistoryAdminRequestError();
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; } catch {
    throw new ReadoutResultHistoryAdminRequestError();
  }
}

export async function hasNoReadoutResultHistoryAdminRequestBody(request: Request): Promise<boolean> {
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
  } finally { await reader.cancel(); }
}

function cookieHeader(
  name: string,
  value: string,
  policy: ReadoutResultHistoryAdminSecurityPolicy,
  options: { httpOnly: boolean; expires: Date }
): string {
  if (!SAFE_COOKIE_VALUE.test(value)) throw new ReadoutResultHistoryAdminConfigurationError("Ogiltig cookie");
  const attributes = [
    `${name}=${value}`, "Path=/", `Expires=${options.expires.toUTCString()}`, "SameSite=Strict"
  ];
  if (options.httpOnly) attributes.push("HttpOnly");
  if (policy.secureCookies) attributes.push("Secure");
  return attributes.join("; ");
}

export function setReadoutResultHistoryAdminCookies(
  response: Response,
  policy: ReadoutResultHistoryAdminSecurityPolicy,
  values: { sessionToken: string; csrfToken: string; expiresAt: string }
): Response {
  const expires = new Date(values.expiresAt);
  if (!Number.isFinite(expires.getTime())) throw new ReadoutResultHistoryAdminConfigurationError("Ogiltig expiry");
  response.headers.append("set-cookie", cookieHeader(policy.cookieNames.session, values.sessionToken, policy, { httpOnly: true, expires }));
  response.headers.append("set-cookie", cookieHeader(policy.cookieNames.csrf, values.csrfToken, policy, { httpOnly: false, expires }));
  return response;
}

export function clearReadoutResultHistoryAdminCookies(
  response: Response,
  policy: ReadoutResultHistoryAdminSecurityPolicy
): Response {
  const expires = new Date(0);
  response.headers.append("set-cookie", cookieHeader(policy.cookieNames.session, "deleted", policy, { httpOnly: true, expires }) + "; Max-Age=0");
  response.headers.append("set-cookie", cookieHeader(policy.cookieNames.csrf, "deleted", policy, { httpOnly: false, expires }) + "; Max-Age=0");
  return response;
}

export function readoutResultHistoryAdminJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privateReadoutResultHistoryAdminHeaders });
}

export function readoutResultHistoryAdminFailure(
  status: 400 | 401 | 403 | 404 | 500,
  error: ReadoutResultHistoryAdminErrorCode
): Response {
  return readoutResultHistoryAdminJson(
    readoutResultHistoryAdminErrorResponseSchema.parse({ formatVersion: 1, error }), status
  );
}

export function readReadoutResultHistoryAdminCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  const names = currentUrl.protocol === "http:" && isLoopback(currentUrl.hostname)
    ? LOOPBACK_COOKIE_NAMES : PRODUCTION_COOKIE_NAMES;
  let found: string | undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== names.csrf) continue;
    if (found !== undefined) return undefined;
    const value = part.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return undefined;
    found = value;
  }
  return found;
}
