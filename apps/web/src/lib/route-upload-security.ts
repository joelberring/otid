import { entryClassAdminErrorResponseSchema, type EntryClassAdminErrorCode } from "@o-tid/contracts";
import { isEntryClassAdminLoopbackHostname } from "./entry-class-admin-cookies";

const safeCookieValue = /^[A-Za-z0-9._~-]+$/;
export const privateRouteUploadHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
} as const;
export type RouteUploadSecurityPolicy = { publicOrigin: string; secureCookies: boolean; cookieNames: { session: string; csrf: string } };
export type RouteUploadSessionProof = { sessionToken: string | null; csrfCookie: string | null; csrfHeader: string | null };
export class RouteUploadConfigurationError extends Error {}

function origin(value: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new RouteUploadConfigurationError("Ogiltig origin"); }
  if (value !== parsed.origin || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new RouteUploadConfigurationError("Icke-kanonisk origin");
  return parsed;
}

export function routeUploadSecurityPolicy(environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env): RouteUploadSecurityPolicy {
  if (!environment.O_TID_PUBLIC_ORIGIN) throw new RouteUploadConfigurationError("Origin saknas");
  const configured = origin(environment.O_TID_PUBLIC_ORIGIN);
  if (environment.NODE_ENV === "production") {
    if (configured.protocol !== "https:") throw new RouteUploadConfigurationError("HTTPS krävs");
    return { publicOrigin: configured.origin, secureCookies: true, cookieNames: { session: "__Host-otid-route-upload-session", csrf: "__Host-otid-route-upload-csrf" } };
  }
  if (configured.protocol !== "http:" || !isEntryClassAdminLoopbackHostname(configured.hostname)) throw new RouteUploadConfigurationError("Endast loopback tillåts");
  return { publicOrigin: configured.origin, secureCookies: false, cookieNames: { session: "otid_route_upload_session", csrf: "otid_route_upload_csrf" } };
}

function cookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie"); if (!header) return null;
  let result: string | undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("="); if (index < 0 || part.slice(0, index).trim() !== name) continue;
    if (result !== undefined) return null;
    const value = part.slice(index + 1).trim(); if (!value || !safeCookieValue.test(value)) return null;
    result = value;
  }
  return result ?? null;
}

export function hasExpectedRouteUploadOrigin(request: Request, policy: RouteUploadSecurityPolicy): boolean { return request.headers.get("origin") === policy.publicOrigin; }
export function routeUploadSessionProof(request: Request, policy: RouteUploadSecurityPolicy, requireCsrf: boolean): RouteUploadSessionProof {
  return { sessionToken: cookie(request, policy.cookieNames.session), csrfCookie: requireCsrf ? cookie(request, policy.cookieNames.csrf) : null,
    csrfHeader: requireCsrf ? request.headers.get("x-otid-csrf") : null };
}

function serializedCookie(name: string, value: string, policy: RouteUploadSecurityPolicy, httpOnly: boolean, expires: Date): string {
  if (!safeCookieValue.test(value)) throw new RouteUploadConfigurationError("Ogiltig cookie");
  return [`${name}=${value}`, "Path=/", `Expires=${expires.toUTCString()}`, "SameSite=Lax", ...(httpOnly ? ["HttpOnly"] : []), ...(policy.secureCookies ? ["Secure"] : [])].join("; ");
}
export function setRouteUploadCookies(response: Response, policy: RouteUploadSecurityPolicy, values: { sessionToken: string; csrfToken: string; expiresAt: string }): Response {
  const expires = new Date(values.expiresAt); if (!Number.isFinite(expires.getTime())) throw new RouteUploadConfigurationError("Ogiltig expiry");
  response.headers.append("set-cookie", serializedCookie(policy.cookieNames.session, values.sessionToken, policy, true, expires));
  response.headers.append("set-cookie", serializedCookie(policy.cookieNames.csrf, values.csrfToken, policy, false, expires));
  return response;
}
export function routeUploadJson(body: unknown, status = 200): Response { return Response.json(body, { status, headers: privateRouteUploadHeaders }); }
export function routeUploadFailure(status: 400 | 401 | 403 | 404 | 409 | 500 | 503, code: EntryClassAdminErrorCode): Response {
  return routeUploadJson(entryClassAdminErrorResponseSchema.parse({ formatVersion: 1, error: code }), status);
}
