export const EVENT_CREATION_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-event-creation-session",
  csrf: "__Host-otid-event-creation-csrf"
} as const;

export const EVENT_CREATION_LOOPBACK_COOKIE_NAMES = {
  session: "otid_event_creation_session",
  csrf: "otid_event_creation_csrf"
} as const;

export type EventCreationCookieNames =
  | typeof EVENT_CREATION_PRODUCTION_COOKIE_NAMES
  | typeof EVENT_CREATION_LOOPBACK_COOKIE_NAMES;

export function isEventCreationLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function eventCreationCookieNamesForUrl(url: URL): EventCreationCookieNames {
  if (url.protocol === "http:" && isEventCreationLoopbackHostname(url.hostname)) {
    return EVENT_CREATION_LOOPBACK_COOKIE_NAMES;
  }
  return EVENT_CREATION_PRODUCTION_COOKIE_NAMES;
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

export function readEventCreationCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  return readUniqueCookie(cookieHeader, eventCreationCookieNamesForUrl(currentUrl).csrf);
}
