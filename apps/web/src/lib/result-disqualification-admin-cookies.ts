export const RESULT_DISQUALIFICATION_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-result-disqualification-admin-session",
  csrf: "__Host-otid-result-disqualification-admin-csrf"
} as const;

export const RESULT_DISQUALIFICATION_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_result_disqualification_admin_session",
  csrf: "otid_result_disqualification_admin_csrf"
} as const;

export type ResultDisqualificationAdminCookieNames =
  | typeof RESULT_DISQUALIFICATION_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof RESULT_DISQUALIFICATION_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isResultDisqualificationAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function resultDisqualificationAdminCookieNamesForUrl(url: URL): ResultDisqualificationAdminCookieNames {
  if (url.protocol === "http:" && isResultDisqualificationAdminLoopbackHostname(url.hostname)) {
    return RESULT_DISQUALIFICATION_ADMIN_LOOPBACK_COOKIE_NAMES;
  }
  return RESULT_DISQUALIFICATION_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readResultDisqualificationAdminCsrfCookie(
  cookieHeader: string,
  currentUrl: URL
): string | undefined {
  return readUniqueCookie(cookieHeader, resultDisqualificationAdminCookieNamesForUrl(currentUrl).csrf);
}
