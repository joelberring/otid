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


