export const RESULT_RECALCULATION_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-recalculation-admin-session",
  csrf: "__Host-otid-recalculation-admin-csrf"
} as const;

export const RESULT_RECALCULATION_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_recalculation_admin_session",
  csrf: "otid_recalculation_admin_csrf"
} as const;

export type ResultRecalculationAdminCookieNames =
  | typeof RESULT_RECALCULATION_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof RESULT_RECALCULATION_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isResultRecalculationAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function resultRecalculationAdminCookieNamesForUrl(url: URL): ResultRecalculationAdminCookieNames {
  if (url.protocol === "http:" && isResultRecalculationAdminLoopbackHostname(url.hostname)) {
    return RESULT_RECALCULATION_ADMIN_LOOPBACK_COOKIE_NAMES;
  }
  return RESULT_RECALCULATION_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readResultRecalculationAdminCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieHeader, resultRecalculationAdminCookieNamesForUrl(currentUrl).csrf);
}
