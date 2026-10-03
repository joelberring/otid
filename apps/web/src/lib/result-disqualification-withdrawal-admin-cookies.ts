export const RESULT_DISQUALIFICATION_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-result-disqualification-withdrawal-admin-session",
  csrf: "__Host-otid-result-disqualification-withdrawal-admin-csrf"
} as const;

export const RESULT_DISQUALIFICATION_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_result_disqualification_withdrawal_admin_session",
  csrf: "otid_result_disqualification_withdrawal_admin_csrf"
} as const;

export type ResultDisqualificationWithdrawalAdminCookieNames =
  | typeof RESULT_DISQUALIFICATION_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof RESULT_DISQUALIFICATION_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isResultDisqualificationWithdrawalAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function resultDisqualificationWithdrawalAdminCookieNamesForUrl(
  url: URL
): ResultDisqualificationWithdrawalAdminCookieNames {
  if (url.protocol === "http:" && isResultDisqualificationWithdrawalAdminLoopbackHostname(url.hostname)) {
    return RESULT_DISQUALIFICATION_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES;
  }
  return RESULT_DISQUALIFICATION_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readResultDisqualificationWithdrawalAdminCsrfCookie(
  cookieHeader: string,
  currentUrl: URL
): string | undefined {
  return readUniqueCookie(cookieHeader, resultDisqualificationWithdrawalAdminCookieNamesForUrl(currentUrl).csrf);
}
