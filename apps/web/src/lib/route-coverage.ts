import { formatHourMinute, zonedDate } from "@o-tid/domain";

/**
 * Användartestet 2026-11-12: en uppladdad rutt som inte täcker någon av löparens sträckor (oftast fel dag eller fel klocka).
 * Bara när löparen har sträckor att täcka (ett resultat med tider); utan resultat är 0 av 0 inget fel.
 */
export const routeCoversNothing = (route: { coveredLegs: number; legs: number }) => route.legs > 0 && route.coveredLegs === 0;

/** "2026-10-18 09:00–09:40" i tävlingens tidszon (datumet två gånger om spannet går över midnatt), eller undefined. */
export function timeSpan(from: string | undefined, to: string | undefined, timeZone: string): string | undefined {
  if (!from) return undefined;
  const start = `${zonedDate(from, timeZone)} ${formatHourMinute(from, timeZone)}`;
  if (!to) return start;
  const sameDay = zonedDate(from, timeZone) === zonedDate(to, timeZone);
  return `${start}–${sameDay ? "" : `${zonedDate(to, timeZone)} `}${formatHourMinute(to, timeZone)}`;
}
