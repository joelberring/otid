export const START_CHECKIN_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-start-checkin-admin-session",
  csrf: "__Host-otid-start-checkin-admin-csrf"
} as const;

export const START_CHECKIN_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_start_checkin_admin_session",
  csrf: "otid_start_checkin_admin_csrf"
} as const;

export const FINISH_FOREST_WATCH_ADMIN_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-finish-forest-watch-admin-session",
  csrf: "__Host-otid-finish-forest-watch-admin-csrf"
} as const;

export const FINISH_FOREST_WATCH_ADMIN_LOOPBACK_COOKIE_NAMES = {
  session: "otid_finish_forest_watch_admin_session",
  csrf: "otid_finish_forest_watch_admin_csrf"
} as const;

export type StartCheckinAdminCookieNames =
  | typeof START_CHECKIN_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof START_CHECKIN_ADMIN_LOOPBACK_COOKIE_NAMES
  | typeof FINISH_FOREST_WATCH_ADMIN_PRODUCTION_COOKIE_NAMES
  | typeof FINISH_FOREST_WATCH_ADMIN_LOOPBACK_COOKIE_NAMES;

export function readFinishForestWatchCsrfCookie(cookieHeader: string, url: URL): string | undefined {
  const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!loopback && url.protocol !== "https:") return undefined;
  const name = (loopback ? FINISH_FOREST_WATCH_ADMIN_LOOPBACK_COOKIE_NAMES : FINISH_FOREST_WATCH_ADMIN_PRODUCTION_COOKIE_NAMES).csrf;
  const values = cookieHeader.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return undefined;
  const value = values[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
