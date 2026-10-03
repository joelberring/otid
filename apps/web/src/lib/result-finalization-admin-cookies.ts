export const RESULT_FINALIZATION_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-finalization-admin-session",
  csrf: "__Host-otid-finalization-admin-csrf"
} as const;

export const RESULT_FINALIZATION_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_finalization_admin_session",
  csrf: "otid_finalization_admin_csrf"
} as const;

export type ResultFinalizationAdminCookieNames =
  | typeof RESULT_FINALIZATION_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof RESULT_FINALIZATION_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isResultFinalizationAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function resultFinalizationAdminCookieNamesForUrl(url: URL): ResultFinalizationAdminCookieNames {
  if (url.protocol === "http:" && isResultFinalizationAdminLoopbackHostname(url.hostname)) {
    return RESULT_FINALIZATION_ADMIN_LOOPBACK_COOKIE_NAMES;
  }
  return RESULT_FINALIZATION_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readResultFinalizationAdminCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieHeader, resultFinalizationAdminCookieNamesForUrl(currentUrl).csrf);
}
