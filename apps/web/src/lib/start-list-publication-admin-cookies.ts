export const START_LIST_PUBLICATION_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-start-list-publication-admin-session",
  csrf: "__Host-otid-start-list-publication-admin-csrf"
} as const;

export const START_LIST_PUBLICATION_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_start_list_publication_admin_session",
  csrf: "otid_start_list_publication_admin_csrf"
} as const;

export type StartListPublicationAdminCookieNames =
  | typeof START_LIST_PUBLICATION_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof START_LIST_PUBLICATION_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isStartListPublicationAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function startListPublicationAdminCookieNamesForUrl(url: URL): StartListPublicationAdminCookieNames {
  if (url.protocol === "http:" && isStartListPublicationAdminLoopbackHostname(url.hostname)) {
    return START_LIST_PUBLICATION_ADMIN_LOOPBACK_COOKIE_NAMES;
  }
  return START_LIST_PUBLICATION_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readStartListPublicationAdminCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieHeader, startListPublicationAdminCookieNamesForUrl(currentUrl).csrf);
}
