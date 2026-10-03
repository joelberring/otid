export const IMPORT_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-import-admin-session",
  csrf: "__Host-otid-import-admin-csrf"
} as const;

export const IMPORT_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_import_admin_session",
  csrf: "otid_import_admin_csrf"
} as const;

export type ImportAdminCookieNames =
  | typeof IMPORT_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof IMPORT_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isImportAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function importAdminCookieNamesForUrl(url: URL): ImportAdminCookieNames {
  if (url.protocol === "http:" && isImportAdminLoopbackHostname(url.hostname)) {
    return IMPORT_ADMIN_LOOPBACK_COOKIE_NAMES;
  }
  return IMPORT_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readImportAdminCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieHeader, importAdminCookieNamesForUrl(currentUrl).csrf);
}
