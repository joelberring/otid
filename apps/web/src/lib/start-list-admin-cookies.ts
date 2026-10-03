export const START_LIST_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-start-list-admin-session",
  csrf: "__Host-otid-start-list-admin-csrf"
} as const;

export const START_LIST_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_start_list_admin_session",
  csrf: "otid_start_list_admin_csrf"
} as const;

export type StartListAdminCookieNames =
  | typeof START_LIST_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof START_LIST_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isStartListAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function startListAdminCookieNamesForUrl(url: URL): StartListAdminCookieNames {
  if (url.protocol === "http:" && isStartListAdminLoopbackHostname(url.hostname)) {
    return START_LIST_ADMIN_LOOPBACK_COOKIE_NAMES;
  }
  return START_LIST_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readStartListAdminCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieHeader, startListAdminCookieNamesForUrl(currentUrl).csrf);
}
