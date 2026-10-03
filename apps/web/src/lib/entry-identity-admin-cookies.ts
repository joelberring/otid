export const ENTRY_IDENTITY_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-entry-identity-admin-session",
  csrf: "__Host-otid-entry-identity-admin-csrf"
} as const;

export const ENTRY_IDENTITY_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_entry_identity_admin_session",
  csrf: "otid_entry_identity_admin_csrf"
} as const;

export type EntryIdentityAdminCookieNames =
  | typeof ENTRY_IDENTITY_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof ENTRY_IDENTITY_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isEntryIdentityAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function entryIdentityAdminCookieNamesForUrl(url: URL): EntryIdentityAdminCookieNames {
  if (url.protocol === "http:" && isEntryIdentityAdminLoopbackHostname(url.hostname)) {
    return ENTRY_IDENTITY_ADMIN_LOOPBACK_COOKIE_NAMES;
  }
  return ENTRY_IDENTITY_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readEntryIdentityAdminCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieHeader, entryIdentityAdminCookieNamesForUrl(currentUrl).csrf);
}


