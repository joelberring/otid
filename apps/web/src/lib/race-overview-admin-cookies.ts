export const RACE_OVERVIEW_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-race-overview-session",
  csrf: "__Host-otid-race-overview-csrf"
} as const;

export const RACE_OVERVIEW_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_race_overview_session",
  csrf: "otid_race_overview_csrf"
} as const;

export type RaceOverviewAdminCookieNames =
  | typeof RACE_OVERVIEW_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof RACE_OVERVIEW_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isRaceOverviewAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function raceOverviewAdminCookieNamesForUrl(url: URL): RaceOverviewAdminCookieNames {
  if (url.protocol === "http:" && isRaceOverviewAdminLoopbackHostname(url.hostname)) {
    return RACE_OVERVIEW_ADMIN_LOOPBACK_COOKIE_NAMES;
  }
  return RACE_OVERVIEW_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readRaceOverviewAdminCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieHeader, raceOverviewAdminCookieNamesForUrl(currentUrl).csrf);
}
