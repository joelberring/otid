export const ENTRY_CLASS_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-entry-class-admin-session",
  csrf: "__Host-otid-entry-class-admin-csrf"
} as const;

export const ENTRY_CLASS_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_entry_class_admin_session",
  csrf: "otid_entry_class_admin_csrf"
} as const;

export type EntryClassAdminCookieNames =
  | typeof ENTRY_CLASS_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof ENTRY_CLASS_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isEntryClassAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function entryClassAdminCookieNamesForUrl(url: URL): EntryClassAdminCookieNames {
  if (url.protocol === "http:" && isEntryClassAdminLoopbackHostname(url.hostname)) {
    return ENTRY_CLASS_ADMIN_LOOPBACK_COOKIE_NAMES;
  }
  return ENTRY_CLASS_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readEntryClassAdminCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieHeader, entryClassAdminCookieNamesForUrl(currentUrl).csrf);
}
