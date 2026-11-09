import { isoWeekday } from "./training-group";

/** ADR-0221: terminsplaneringens veckor. Rena funktioner på datum ÅÅÅÅ-MM-DD (UTC, utan klockslag). */
const DAY_MS = 86_400_000;
const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);
const format = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Högst så här många dagar i en termin (som villkoret i migration 0109). */
export const MAX_TERM_DAYS = 400;

/** ISO 8601-veckan för ett datum: året veckan hör till och veckans nummer (1–53). */
export function isoWeek(date: string): { year: number; week: number } {
  const ms = parse(date);
  const thursday = ms + (4 - isoWeekday(date)) * DAY_MS;
  const year = new Date(thursday).getUTCFullYear();
  const firstThursday = Date.UTC(year, 0, 1) + ((4 - isoWeekday(`${year}-01-01`) + 7) % 7) * DAY_MS;
  return { year, week: Math.round((thursday - firstThursday) / (7 * DAY_MS)) + 1 };
}

export interface TermWeek { readonly year: number; readonly week: number; readonly monday: string; readonly sunday: string }

/** Veckorna som terminen berör, från veckan med första dagen till veckan med sista; tom lista om datumen är fel. */
export function termWeeks(startsOn: string, endsOn: string): TermWeek[] {
  const start = parse(startsOn), end = parse(endsOn);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || (end - start) / DAY_MS > MAX_TERM_DAYS) return [];
  const weeks: TermWeek[] = [];
  for (let monday = start - (isoWeekday(startsOn) - 1) * DAY_MS; monday <= end; monday += 7 * DAY_MS) {
    const date = format(monday);
    weeks.push({ ...isoWeek(date), monday: date, sunday: format(monday + 6 * DAY_MS) });
  }
  return weeks;
}

/** Om datumet ligger i terminen (första och sista dagen räknas med). */
export const inTerm = (date: string, term: { startsOn: string; endsOn: string }) => date >= term.startsOn && date <= term.endsOn;

/**
 * Ett förslag på nästa termin att planera: januari–mars den här våren (VT, januari–juni), april–september den här hösten
 * (HT, augusti–december), från oktober nästa vår.
 */
export function suggestedTerm(today: string, spring: { name: string }, autumn: { name: string }): { name: string; startsOn: string; endsOn: string } {
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  if (month >= 4 && month <= 9) return { name: `${autumn.name} ${year}`, startsOn: `${year}-08-01`, endsOn: `${year}-12-31` };
  const springYear = month >= 10 ? year + 1 : year;
  return { name: `${spring.name} ${springYear}`, startsOn: `${springYear}-01-01`, endsOn: `${springYear}-06-30` };
}
