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

/**
 * ADR-0205: den påbörjade Google-inloggningen (state, nonce och PKCE-verifierare) mellan start och återkomst. SameSite=Lax,
 * eftersom återkomsten är en navigering från Google; `__Host-` i drift så att ingen annan värd under domänen kan sätta den.
 */
export function googleLoginCookieName(secure: boolean): string {
  return secure ? "__Host-otid-google-login" : "otid_google_login";
}

/**
 * ADR-0205 tillägg: den påbörjade flytten av en Google-koppling (signerad, tio minuter) mellan återkomsten från Google och
 * bekräftelsen under Mitt konto. SameSite=Strict: den läses bara av O-Tids egna sidor.
 */
export function googleMoveCookieName(secure: boolean): string {
  return secure ? "__Host-otid-google-move" : "otid_google_move";
}

/**
 * ADR-0205 tillägg 2026-11-12: registreringens hemlighet (HttpOnly, en timme). Bekräftelselänken som öppnas i samma webbläsare
 * bekräftar adressen med lösenordet från registreringen. SameSite=Strict: den läses bara av bekräftelsesidans egna anrop.
 */
export function registrationCookieName(secure: boolean): string {
  return secure ? "__Host-otid-registration" : "otid_registration";
}
