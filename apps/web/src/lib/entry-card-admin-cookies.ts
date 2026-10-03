export const ENTRY_CARD_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-entry-card-admin-session",
  csrf: "__Host-otid-entry-card-admin-csrf"
} as const;

export const ENTRY_CARD_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_entry_card_admin_session",
  csrf: "otid_entry_card_admin_csrf"
} as const;

export type EntryCardAdminCookieNames =
  | typeof ENTRY_CARD_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof ENTRY_CARD_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isEntryCardAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function entryCardAdminCookieNamesForUrl(url: URL): EntryCardAdminCookieNames {
  if (url.protocol === "http:" && isEntryCardAdminLoopbackHostname(url.hostname)) {
    return ENTRY_CARD_ADMIN_LOOPBACK_COOKIE_NAMES;
  }
  return ENTRY_CARD_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readEntryCardAdminCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieHeader, entryCardAdminCookieNamesForUrl(currentUrl).csrf);
}

