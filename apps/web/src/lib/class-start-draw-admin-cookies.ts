export const CLASS_START_DRAW_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-class-start-draw-admin-session",
  csrf: "__Host-otid-class-start-draw-admin-csrf"
} as const;

export const CLASS_START_DRAW_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_class_start_draw_admin_session",
  csrf: "otid_class_start_draw_admin_csrf"
} as const;

export type ClassStartDrawAdminCookieNames =
  | typeof CLASS_START_DRAW_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof CLASS_START_DRAW_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isClassStartDrawAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function classStartDrawAdminCookieNamesForUrl(url: URL): ClassStartDrawAdminCookieNames {
  if (url.protocol === "http:" && isClassStartDrawAdminLoopbackHostname(url.hostname)) {
    return CLASS_START_DRAW_ADMIN_LOOPBACK_COOKIE_NAMES;
  }
  return CLASS_START_DRAW_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readClassStartDrawAdminCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieHeader, classStartDrawAdminCookieNamesForUrl(currentUrl).csrf);
}
