export const ENTRY_START_TIME_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-entry-start-time-admin-session",
  csrf: "__Host-otid-entry-start-time-admin-csrf"
} as const;

export const ENTRY_START_TIME_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_entry_start_time_admin_session",
  csrf: "otid_entry_start_time_admin_csrf"
} as const;

export type EntryStartTimeAdminCookieNames =
  | typeof ENTRY_START_TIME_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof ENTRY_START_TIME_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isEntryStartTimeAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function entryStartTimeAdminCookieNamesForUrl(url: URL): EntryStartTimeAdminCookieNames {
  if (url.protocol === "http:" && isEntryStartTimeAdminLoopbackHostname(url.hostname)) {
    return ENTRY_START_TIME_ADMIN_LOOPBACK_COOKIE_NAMES;
  }
  return ENTRY_START_TIME_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readEntryStartTimeAdminCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieHeader, entryStartTimeAdminCookieNamesForUrl(currentUrl).csrf);
}
