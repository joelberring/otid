export const RACE_ADMINISTRATOR_PRODUCTION_COOKIES = {
  session: "__Host-otid-race-administrator-session", csrf: "__Host-otid-race-administrator-csrf"
} as const;
export const RACE_ADMINISTRATOR_LOOPBACK_COOKIES = {
  session: "otid_race_administrator_session", csrf: "otid_race_administrator_csrf"
} as const;

export function readRaceAdministratorCsrfCookie(header: string, url: URL): string | undefined {
  const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const name = (loopback ? RACE_ADMINISTRATOR_LOOPBACK_COOKIES : RACE_ADMINISTRATOR_PRODUCTION_COOKIES).csrf;
  const values = header.split(";").filter((part) => part.slice(0, part.indexOf("=")).trim() === name);
  if (values.length !== 1) return undefined;
  const value = values[0]?.slice(values[0].indexOf("=") + 1).trim();
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
