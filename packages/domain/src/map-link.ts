import { nextRaceDate, parseRaceClock } from "./race-clock";

/**
 * ADR-0214: länken till kartritaren. Nyckeln är 32 slumpade byte i base64url (256 bitar, 43 tecken); bara dess sha256
 * sparas. Länken gäller tills den stängs av, en ny länk skapas eller (valfritt) till och med ett datum i tävlingens
 * tidszon. Ren logik utan I/O; nyckeln skapas och slås upp i `@o-tid/application`.
 */
export const MAP_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** Föreslaget sista datum när "Begränsa tiden" slås på: tävlingsdagen och en vecka till. */
export const MAP_LINK_SUGGESTED_DAYS_AFTER_RACE = 7;

/** Ser ut som en nyckel (rätt längd och tecken). Avgör inget om länken finns; det gör uppslaget på hashen. */
export function isMapLinkToken(value: string): boolean {
  return MAP_LINK_TOKEN_PATTERN.test(value);
}

/** Datumet `days` dagar efter (ÅÅÅÅ-MM-DD). */
function plusDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Förslaget till sista dag: tävlingsdagen plus en vecka, men aldrig före i dag. */
export function suggestedMapLinkLastDay(raceDate: string, today: string): string {
  const suggested = plusDays(raceDate, MAP_LINK_SUGGESTED_DAYS_AFTER_RACE);
  return suggested < today ? plusDays(today, MAP_LINK_SUGGESTED_DAYS_AFTER_RACE) : suggested;
}

/**
 * När länken slutar gälla om den gäller till och med `lastDay`: midnatt efter den dagen i tävlingens tidszon. null när
 * datumet inte är ett giltigt datum.
 */
export function mapLinkExpiresAt(lastDay: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) return null;
  const [year, month, day] = lastDay.split("-").map(Number) as [number, number, number];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const instant = parseRaceClock(nextRaceDate(lastDay), "00:00", timeZone);
  return instant ? new Date(instant) : null;
}

export interface MapLinkTimes {
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
}

/** Länkens läge just nu: gäller, har gått ut eller är avstängd. */
export function mapLinkStatus(link: MapLinkTimes, now: Date): "ACTIVE" | "EXPIRED" | "REVOKED" {
  if (link.revokedAt) return "REVOKED";
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return "ACTIVE";
}

/** Journalen får en rad om att länken öppnades högst en gång i timmen (sidan och kartan hämtas flera gånger). */
export const MAP_LINK_OPEN_JOURNAL_INTERVAL_MS = 60 * 60 * 1000;

export function mapLinkOpenJournaled(lastOpenedAt: Date | null, now: Date): boolean {
  return lastOpenedAt === null || now.getTime() - lastOpenedAt.getTime() >= MAP_LINK_OPEN_JOURNAL_INTERVAL_MS;
}

/** Namnet kartritaren skriver (valfritt): trimmat, utan styrtecken, högst 80 tecken; tomt blir null ("Kartritaren"). */
export function mapMakerName(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").replace(/\s+/g, " ").replace(/\p{Cc}/gu, "").trim().slice(0, 80).trim();
  return cleaned || null;
}
