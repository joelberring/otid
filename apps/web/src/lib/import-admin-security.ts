import {
  IMPORT_ADMIN_LOOPBACK_COOKIE_NAMES,
  IMPORT_ADMIN_PRODUCTION_COOKIE_NAMES,
  isImportAdminLoopbackHostname,
  type ImportAdminCookieNames
} from "./import-admin-cookies";
import {
  IOF_IMPORT_CONTENT_TYPE,
  IOF_IMPORT_MAX_BYTES,
  iofImportErrorResponseSchema,
  type IofImportErrorCode
} from "@o-tid/contracts";

const MAX_JSON_BODY_BYTES = 4 * 1024;
const SAFE_COOKIE_VALUE = /^[A-Za-z0-9._~-]+$/;

export const privateImportAdminHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
} as const;

export interface ImportAdminSecurityPolicy {
  publicOrigin: string;
  cookieNames: ImportAdminCookieNames;
  secureCookies: boolean;
}

export interface ImportAdminSessionProof {
  sessionToken: string | null;
  csrfCookie: string | null;
  csrfHeader: string | null;
}

export interface AcceptedIofImportBody {
  bytes: Uint8Array;
  xml: string;
}

export class ImportAdminRequestError extends Error {}
export class ImportAdminConfigurationError extends Error {}

function parseConfiguredOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ImportAdminConfigurationError("O_TID_PUBLIC_ORIGIN är inte en giltig URL-origin");
  }
  if (value !== url.origin || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new ImportAdminConfigurationError("O_TID_PUBLIC_ORIGIN måste vara en exakt canonical origin");
  }
  return url;
}

export function importAdminSecurityPolicy(
  environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env
): ImportAdminSecurityPolicy {
  const configuredOrigin = environment.O_TID_PUBLIC_ORIGIN;
  if (!configuredOrigin) throw new ImportAdminConfigurationError("O_TID_PUBLIC_ORIGIN saknas");
  const url = parseConfiguredOrigin(configuredOrigin);
  if (environment.NODE_ENV === "production") {
    if (url.protocol !== "https:") throw new ImportAdminConfigurationError("Produktion kräver HTTPS-origin");
    return { publicOrigin: url.origin, cookieNames: IMPORT_ADMIN_PRODUCTION_COOKIE_NAMES, secureCookies: true };
  }
  if (url.protocol !== "http:" || !isImportAdminLoopbackHostname(url.hostname)) {
    throw new ImportAdminConfigurationError("Utvecklingspolicy tillåter endast explicit HTTP-loopback-origin");
  }
  return { publicOrigin: url.origin, cookieNames: IMPORT_ADMIN_LOOPBACK_COOKIE_NAMES, secureCookies: false };
}

export function hasExpectedImportAdminOrigin(request: Request, policy: ImportAdminSecurityPolicy): boolean {
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

export function importAdminSessionProof(
  request: Request,
  policy: ImportAdminSecurityPolicy,
  requireCsrf: boolean
): ImportAdminSessionProof {
  return {
    sessionToken: readUniqueCookie(request, policy.cookieNames.session),
    csrfCookie: requireCsrf ? readUniqueCookie(request, policy.cookieNames.csrf) : null,
    csrfHeader: requireCsrf ? request.headers.get("x-otid-csrf") : null
  };
}

export async function readBoundedBytes(request: Request, limit: number): Promise<Uint8Array> {
  if (!request.body) throw new ImportAdminRequestError("Body saknas");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new ImportAdminRequestError("Bodyn är för stor");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (length === 0) throw new ImportAdminRequestError("Body saknas");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function validDeclaredLength(request: Request, maximum: number): boolean {
  const value = request.headers.get("content-length");
  return value === null || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= maximum);
}

export async function readImportAdminJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json" || !validDeclaredLength(request, MAX_JSON_BODY_BYTES)) {
    throw new ImportAdminRequestError("Ogiltig JSON-request");
  }
  const bytes = await readBoundedBytes(request, MAX_JSON_BODY_BYTES);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ImportAdminRequestError("Ogiltig JSON");
  }
}

export async function readIofImportBody(request: Request): Promise<AcceptedIofImportBody> {
  if (request.headers.get("content-type") !== IOF_IMPORT_CONTENT_TYPE || !validDeclaredLength(request, IOF_IMPORT_MAX_BYTES)) {
    throw new ImportAdminRequestError("Ogiltig XML-request");
  }
  const bytes = await readBoundedBytes(request, IOF_IMPORT_MAX_BYTES);
  try {
    return { bytes, xml: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    throw new ImportAdminRequestError("XML måste vara strikt UTF-8");
  }
}

export async function hasNoImportAdminRequestBody(request: Request): Promise<boolean> {
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
  if (!SAFE_COOKIE_VALUE.test(value)) throw new ImportAdminConfigurationError("Ogiltigt cookie-värde");
  return value;
}

function cookieHeader(
  name: string,
  value: string,
  policy: ImportAdminSecurityPolicy,
  options: { httpOnly: boolean; expires: Date }
): string {
  const attributes = [`${name}=${safeCookieValue(value)}`, "Path=/", `Expires=${options.expires.toUTCString()}`, "SameSite=Strict"];
  if (options.httpOnly) attributes.push("HttpOnly");
  if (policy.secureCookies) attributes.push("Secure");
  return attributes.join("; ");
}

export function setImportAdminCookies(
  response: Response,
  policy: ImportAdminSecurityPolicy,
  values: { sessionToken: string; csrfToken: string; expiresAt: string }
): Response {
  const expires = new Date(values.expiresAt);
  if (!Number.isFinite(expires.getTime())) throw new ImportAdminConfigurationError("Ogiltig sessionsexpiry");
  response.headers.append("set-cookie", cookieHeader(policy.cookieNames.session, values.sessionToken, policy, { httpOnly: true, expires }));
  response.headers.append("set-cookie", cookieHeader(policy.cookieNames.csrf, values.csrfToken, policy, { httpOnly: false, expires }));
  return response;
}

export function clearImportAdminCookies(response: Response, policy: ImportAdminSecurityPolicy): Response {
  const expired = new Date(0);
  response.headers.append("set-cookie", `${cookieHeader(policy.cookieNames.session, "deleted", policy, { httpOnly: true, expires: expired })}; Max-Age=0`);
  response.headers.append("set-cookie", `${cookieHeader(policy.cookieNames.csrf, "deleted", policy, { httpOnly: false, expires: expired })}; Max-Age=0`);
  return response;
}

export function importAdminJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privateImportAdminHeaders });
}

export function importAdminFailure(status: 400 | 401 | 403 | 409 | 422 | 500, code: IofImportErrorCode): Response {
  return importAdminJson(iofImportErrorResponseSchema.parse({ formatVersion: 1, error: code }), status);
}
