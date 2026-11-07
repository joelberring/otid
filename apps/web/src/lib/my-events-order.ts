/**
 * Mina tävlingar (PLAN.md steg 27): idag och kommande först, närmast först, sedan de som varit, senaste först. Ett
 * arrangemang med flera lopp sorteras efter sitt närmaste kommande lopp, annars efter sitt senaste. "Idag" räknas i
 * arrangemangets tidszon. Loppen inom ett arrangemang följer samma ordning.
 */
import { zonedDate } from "@o-tid/domain";
type Race = { raceDate: string };
type EventWithRaces<R extends Race> = { timeZone: string; startsOn: string; races: readonly R[] };

/** Dagens datum (ÅÅÅÅ-MM-DD) i tidszonen; webbläsarens tid om zonen är okänd. */
export function todayIn(timeZone: string, now: Date): string {
  try {
    return zonedDate(now, timeZone);
  } catch {
    return new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  }
}

/** Kommande (eller idag) före gångna; kommande stigande, gångna fallande. */
function compareDates(left: string, right: string, today: string): number {
  const leftUpcoming = left >= today, rightUpcoming = right >= today;
  if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;
  return leftUpcoming ? left.localeCompare(right) : right.localeCompare(left);
}

export function orderMyEvents<R extends Race, E extends EventWithRaces<R>>(events: readonly E[], now: Date): E[] {
  const keyed = events.map((event) => {
    const today = todayIn(event.timeZone, now);
    const races = [...event.races].sort((left, right) => compareDates(left.raceDate, right.raceDate, today));
    const key = races[0]?.raceDate ?? event.startsOn;
    return { event: { ...event, races }, key, upcoming: key >= today };
  });
  return keyed.sort((left, right) => left.upcoming !== right.upcoming ? (left.upcoming ? -1 : 1)
    : left.upcoming ? left.key.localeCompare(right.key) : right.key.localeCompare(left.key))
    .map((row) => row.event);
}

/**
 * Ägaren 2026-11-04: långa listor. Idag och kommande överst; de som varit fälls ihop under "Tidigare tävlingar (n)", senaste
 * först. Ordningen är densamma som `orderMyEvents`, bara delad (också för den som bara är funktionär).
 */
export function splitMyEvents<R extends Race, E extends EventWithRaces<R>>(events: readonly E[], now: Date): { current: E[]; past: E[] } {
  const ordered = orderMyEvents<R, E>(events, now);
  const upcoming = (event: E) => (event.races[0]?.raceDate ?? event.startsOn) >= todayIn(event.timeZone, now);
  return { current: ordered.filter(upcoming), past: ordered.filter(event => !upcoming(event)) };
}
