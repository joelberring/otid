export const WITHOUT_TIMING_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-without-timing-admin-session",
  csrf: "__Host-otid-without-timing-admin-csrf"
} as const;

export const WITHOUT_TIMING_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_without_timing_admin_session",
  csrf: "otid_without_timing_admin_csrf"
} as const;

export function isWithoutTimingAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function withoutTimingAdminCookieNamesForUrl(url: URL) {
  return url.protocol === "http:" && isWithoutTimingAdminLoopbackHostname(url.hostname)
    ? WITHOUT_TIMING_ADMIN_LOOPBACK_COOKIE_NAMES
    : WITHOUT_TIMING_ADMIN_PRODUCTION_COOKIE_NAMES;
}

function readUniqueCookie(cookieText: string, name: string): string | undefined {
  let found: string | undefined;
  for (const part of cookieText.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    if (found !== undefined || !/^[A-Za-z0-9_-]{43}$/.test(value)) return undefined;
    found = value;
  }
  return found;
}

export function readWithoutTimingAdminCsrfCookie(cookieText: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieText, withoutTimingAdminCookieNamesForUrl(currentUrl).csrf);
}
