export const WITHOUT_TIMING_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-without-timing-withdrawal-admin-session",
  csrf: "__Host-otid-without-timing-withdrawal-admin-csrf"
} as const;

export const WITHOUT_TIMING_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_without_timing_withdrawal_admin_session",
  csrf: "otid_without_timing_withdrawal_admin_csrf"
} as const;

export type WithoutTimingWithdrawalAdminCookieNames =
  | typeof WITHOUT_TIMING_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof WITHOUT_TIMING_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isWithoutTimingWithdrawalAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function withoutTimingWithdrawalAdminCookieNamesForUrl(
  url: URL
): WithoutTimingWithdrawalAdminCookieNames {
  return url.protocol === "http:" && isWithoutTimingWithdrawalAdminLoopbackHostname(url.hostname)
    ? WITHOUT_TIMING_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES
    : WITHOUT_TIMING_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readWithoutTimingWithdrawalAdminCsrfCookie(
  cookieHeader: string,
  currentUrl: URL
): string | undefined {
  return readUniqueCookie(cookieHeader, withoutTimingWithdrawalAdminCookieNamesForUrl(currentUrl).csrf);
}
