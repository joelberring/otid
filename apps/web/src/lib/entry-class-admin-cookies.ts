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
