export const PAIRING_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-pairing-admin-session",
  csrf: "__Host-otid-pairing-admin-csrf"
} as const;

export const PAIRING_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_pairing_admin_session",
  csrf: "otid_pairing_admin_csrf"
} as const;

export type PairingAdminCookieNames =
  | typeof PAIRING_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof PAIRING_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isPairingAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function pairingAdminCookieNamesForUrl(url: URL): PairingAdminCookieNames {
  if (url.protocol === "http:" && isPairingAdminLoopbackHostname(url.hostname)) {
    return PAIRING_ADMIN_LOOPBACK_COOKIE_NAMES;
  }
  return PAIRING_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readPairingAdminCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieHeader, pairingAdminCookieNamesForUrl(currentUrl).csrf);
}
