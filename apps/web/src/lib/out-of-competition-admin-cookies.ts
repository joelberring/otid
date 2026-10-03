export const OUT_OF_COMPETITION_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-out-of-competition-admin-session",
  csrf: "__Host-otid-out-of-competition-admin-csrf"
} as const;

export const OUT_OF_COMPETITION_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_out_of_competition_admin_session",
  csrf: "otid_out_of_competition_admin_csrf"
} as const;

export type OutOfCompetitionAdminCookieNames =
  | typeof OUT_OF_COMPETITION_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof OUT_OF_COMPETITION_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isOutOfCompetitionAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function outOfCompetitionAdminCookieNamesForUrl(url: URL): OutOfCompetitionAdminCookieNames {
  return url.protocol === "http:" && isOutOfCompetitionAdminLoopbackHostname(url.hostname)
    ? OUT_OF_COMPETITION_ADMIN_LOOPBACK_COOKIE_NAMES : OUT_OF_COMPETITION_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readOutOfCompetitionAdminCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieHeader, outOfCompetitionAdminCookieNamesForUrl(currentUrl).csrf);
}
