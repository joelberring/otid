export const RESULT_APPROVAL_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-result-approval-admin-session",
  csrf: "__Host-otid-result-approval-admin-csrf"
} as const;

export const RESULT_APPROVAL_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_result_approval_admin_session",
  csrf: "otid_result_approval_admin_csrf"
} as const;

export type ResultApprovalAdminCookieNames =
  | typeof RESULT_APPROVAL_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof RESULT_APPROVAL_ADMIN_LOOPBACK_COOKIE_NAMES;

export function isResultApprovalAdminLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function resultApprovalAdminCookieNamesForUrl(url: URL): ResultApprovalAdminCookieNames {
  return url.protocol === "http:" && isResultApprovalAdminLoopbackHostname(url.hostname)
    ? RESULT_APPROVAL_ADMIN_LOOPBACK_COOKIE_NAMES : RESULT_APPROVAL_ADMIN_PRODUCTION_COOKIE_NAMES;
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

export function readResultApprovalAdminCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieHeader, resultApprovalAdminCookieNamesForUrl(currentUrl).csrf);
}
