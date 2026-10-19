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

/** Kontots sessionscookie för serverns sidor: samma val som `organizerSecurityPolicy` (drift eller lokal adress). */
export function organizerAccountSessionCookieName(environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV">> = process.env): string {
  return environment.NODE_ENV === "production" ? ORGANIZER_ACCOUNT_PRODUCTION_COOKIES.session : ORGANIZER_ACCOUNT_LOOPBACK_COOKIES.session;
}

/** Kontots CSRF-kaka i webbläsaren (en, giltig), eller undefined. Samma kaka gäller tävlingens adminförfrågningar. */
export function readAccountCsrfCookie(cookieText: string, currentUrl: URL): string | undefined {
  const loopback = currentUrl.protocol === "http:" && isOrganizerLoopback(currentUrl.hostname);
  const name = (loopback ? ORGANIZER_ACCOUNT_LOOPBACK_COOKIES : ORGANIZER_ACCOUNT_PRODUCTION_COOKIES).csrf;
  const values = cookieText.split(";").filter((part) => part.slice(0, part.indexOf("=")).trim() === name);
  if (values.length !== 1) return undefined;
  const value = values[0]!.slice(values[0]!.indexOf("=") + 1).trim();
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
