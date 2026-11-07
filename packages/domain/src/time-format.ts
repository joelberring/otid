/**
 * Tider och datum som de skrivs i O-Tid (svenska, 24-timmarsklocka). Ren formatering utan I/O, så att listor, kvitton,
 * arbetsytan och servern skriver samma sak.
 */

/**
 * En löptid som m:ss, eller h:mm:ss från en timme. Sekunderna avrundas nedåt (orienteringens praxis);
 * millisekunder visas aldrig i listor och sträcktider.
 */
export function formatDuration(milliseconds: number): string {
  const total = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(total / 3_600), minutes = Math.floor(total / 60) % 60, seconds = total % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Ett ögonblick som klockslag (HH:MM:SS) i tidszonen, utan datum och utan tidszonsbeteckning (ADR-0169 beslut 4). */
export function formatClockTime(instant: string, timeZone: string): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return "–";
  return new Intl.DateTimeFormat("sv-SE", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .format(date);
}

/** Ett ögonblick som klockslag utan sekunder (HH:MM) i tidszonen. */
export function formatHourMinute(instant: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));
}

/** Datumet (ÅÅÅÅ-MM-DD) för ett ögonblick i tidszonen. */
export function zonedDate(instant: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
}

/** Ett ögonblick som datum och klockslag, "5 okt. 18:02", i tidszonen; "–" för ett ogiltigt ögonblick. */
export function formatDayMonthTime(instant: string | Date, timeZone: string): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return "–";
  return new Intl.DateTimeFormat("sv-SE", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23" }).format(date);
}
