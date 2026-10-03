export const OUT_OF_COMPETITION_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-out-of-competition-withdrawal-admin-session",
  csrf: "__Host-otid-out-of-competition-withdrawal-admin-csrf"
} as const;

export const OUT_OF_COMPETITION_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_out_of_competition_withdrawal_admin_session",
  csrf: "otid_out_of_competition_withdrawal_admin_csrf"
} as const;

export type OutOfCompetitionWithdrawalAdminCookieNames =
  | typeof OUT_OF_COMPETITION_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof OUT_OF_COMPETITION_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isOutOfCompetitionWithdrawalAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function outOfCompetitionWithdrawalAdminCookieNamesForUrl(
  url: URL
): OutOfCompetitionWithdrawalAdminCookieNames {
  return url.protocol === "http:" && isOutOfCompetitionWithdrawalAdminLoopbackHostname(url.hostname)
    ? OUT_OF_COMPETITION_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES
    : OUT_OF_COMPETITION_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readOutOfCompetitionWithdrawalAdminCsrfCookie(
  cookieHeader: string,
  currentUrl: URL
): string | undefined {
  return readUniqueCookie(cookieHeader, outOfCompetitionWithdrawalAdminCookieNamesForUrl(currentUrl).csrf);
}
