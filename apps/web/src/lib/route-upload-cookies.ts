export const ROUTE_UPLOAD_PRODUCTION_COOKIES = {
  session: "__Host-otid-route-upload-session", csrf: "__Host-otid-route-upload-csrf"
} as const;
export const ROUTE_UPLOAD_LOOPBACK_COOKIES = {
  session: "otid_route_upload_session", csrf: "otid_route_upload_csrf"
} as const;

function namesForUrl(url: URL) {
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    ? ROUTE_UPLOAD_LOOPBACK_COOKIES
    : ROUTE_UPLOAD_PRODUCTION_COOKIES;
}

/** Reads only the non-HttpOnly anti-forgery cookie; the session cookie stays opaque to JavaScript. */
export function readRouteUploadCsrfCookie(cookieHeader: string, currentUrl: URL): string | undefined {
  const name = namesForUrl(currentUrl).csrf;
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
