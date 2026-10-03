export const DID_NOT_FINISH_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-did-not-finish-withdrawal-admin-session",
  csrf: "__Host-otid-did-not-finish-withdrawal-admin-csrf"
} as const;

export const DID_NOT_FINISH_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_did_not_finish_withdrawal_admin_session",
  csrf: "otid_did_not_finish_withdrawal_admin_csrf"
} as const;

export type DidNotFinishWithdrawalAdminCookieNames =
  | typeof DID_NOT_FINISH_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof DID_NOT_FINISH_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isDidNotFinishWithdrawalAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function didNotFinishWithdrawalAdminCookieNamesForUrl(url: URL): DidNotFinishWithdrawalAdminCookieNames {
  return url.protocol === "http:" && isDidNotFinishWithdrawalAdminLoopbackHostname(url.hostname)
    ? DID_NOT_FINISH_WITHDRAWAL_ADMIN_LOOPBACK_COOKIE_NAMES
    : DID_NOT_FINISH_WITHDRAWAL_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readDidNotFinishWithdrawalAdminCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieHeader, didNotFinishWithdrawalAdminCookieNamesForUrl(currentUrl).csrf);
}
