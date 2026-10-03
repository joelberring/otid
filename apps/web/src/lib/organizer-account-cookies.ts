export const ORGANIZER_ACCOUNT_PRODUCTION_COOKIES = {
  session: "__Host-otid-organizer-session",
  csrf: "__Host-otid-organizer-csrf"
} as const;

export const ORGANIZER_ACCOUNT_LOOPBACK_COOKIES = {
  session: "otid_organizer_session",
  csrf: "otid_organizer_csrf"
} as const;

export type OrganizerAccountCookieNames =
  | typeof ORGANIZER_ACCOUNT_PRODUCTION_COOKIES
  | typeof ORGANIZER_ACCOUNT_LOOPBACK_COOKIES;

export function isOrganizerLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
