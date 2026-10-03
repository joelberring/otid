export const DID_NOT_START_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-did-not-start-admin-session",
  csrf: "__Host-otid-did-not-start-admin-csrf"
} as const;

export const DID_NOT_START_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_did_not_start_admin_session",
  csrf: "otid_did_not_start_admin_csrf"
} as const;

export type DidNotStartAdminCookieNames =
  | typeof DID_NOT_START_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof DID_NOT_START_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isDidNotStartAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function didNotStartAdminCookieNamesForUrl(url: URL): DidNotStartAdminCookieNames {
  if (url.protocol === "http:" && isDidNotStartAdminLoopbackHostname(url.hostname)) {
    return DID_NOT_START_ADMIN_LOOPBACK_COOKIE_NAMES;
  }
  return DID_NOT_START_ADMIN_PRODUCTION_COOKIE_NAMES;
}

function readUniqueCookie(cookieHeader: string, name: string): string | undefined {
  let found: string | undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    if (found !== undefined) return undefined;
    const value = part.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return undefined;
    found = value;
  }
  return found;
}

export function readDidNotStartAdminCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieHeader, didNotStartAdminCookieNamesForUrl(currentUrl).csrf);
}
