import { localRaceDate } from "./race-clock";

/**
 * PLAN.md steg 41: självregistrering på tävlingsdagen. Ren logik: när formuläret är öppet och hur ett namn normaliseras.
 */

/** En fest håller på efter midnatt: självregistreringen är öppen till kl 06 dagen efter festens datum. */
export const PARTY_SELF_REGISTRATION_GRACE_HOURS = 6;

function nextDate(date: string): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function localHour(instant: Date, timeZone: string): number {
  const value = new Intl.DateTimeFormat("sv-SE", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(instant);
  return Number(value);
}

/**
 * Sant på tävlingsdagen i tävlingens tidszon (från midnatt till midnatt). För en fest också natten efter, till kl 06.
 */
export function selfRegistrationDay(input: { raceDate: string; timeZone: string; party: boolean; now: Date }): boolean {
  const today = localRaceDate(input.now, input.timeZone);
  if (today === input.raceDate) return true;
  return input.party && today === nextDate(input.raceDate) && localHour(input.now, input.timeZone) < PARTY_SELF_REGISTRATION_GRACE_HOURS;
}

/**
 * Ett namn som det sparas: styrtecken och tecken som inte hör hemma i ett namn bort, blanksteg ihop, högst `max` tecken.
 * Bokstäver (alla skriftsystem), siffror, blanksteg, bindestreck, apostrof och punkt behålls. Tomt blir undefined.
 */
export function normalizeSelfRegistrationName(value: string, max: number): string | undefined {
  const text = value.normalize("NFC").replace(/[^\p{L}\p{M}\p{N} .'’-]/gu, " ").replace(/\s+/g, " ").trim();
  if (text.length === 0 || text.length > max) return undefined;
  if (!/\p{L}/u.test(text)) return undefined;
  return text;
}
