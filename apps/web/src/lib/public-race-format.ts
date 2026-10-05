/**
 * Datum och adresser på den publika ytan (ADR-0172 beslut 4). Ren formatering utan I/O, så att startsidan,
 * tävlingssidan, QR-sidan och arbetsytan skriver samma sak.
 */

/** Tävlingens datum (ÅÅÅÅ-MM-DD) som "tors 8 okt. 2026"; året utelämnas när det är samma år som `today`. */
export function formatRaceDate(raceDate: string, today?: string): string {
  const date = new Date(`${raceDate}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return raceDate;
  const sameYear = today !== undefined && today.slice(0, 4) === raceDate.slice(0, 4);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short",
    ...(sameYear ? {} : { year: "numeric" }) }).format(date);
}

/** Ett ögonblick som "5 okt. 18:02" i tävlingens tidszon. */
export function formatRaceInstant(instant: string, timeZone: string): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return "–";
  return new Intl.DateTimeFormat("sv-SE", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23" }).format(date);
}

/** Dagens datum (ÅÅÅÅ-MM-DD) i en tidszon. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Tävlingssidans korta adress. */
export const raceHubPath = (shortCode: string) => `/t/${shortCode}`;
export const raceQrPath = (shortCode: string) => `/t/${shortCode}/qr`;

/** Adressen som text utan protokoll, t.ex. "o-tid.se/t/k7m2qx", för utskrift och visning. */
export function displayAddress(origin: string, path: string): string {
  const url = new URL(path, origin);
  return `${url.host}${url.pathname}`;
}
