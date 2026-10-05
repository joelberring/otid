/** Ett ögonblick som klockslag (HH:MM:SS) i tävlingens tidszon, utan datum och utan tidszonsbeteckning (ADR-0169 beslut 4). */
export function formatClockTime(instant: string, timeZone: string): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return "–";
  return new Intl.DateTimeFormat("sv-SE", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .format(date);
}

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

/** Datumet (ÅÅÅÅ-MM-DD) för ett ögonblick i tävlingens tidszon. */
export function zonedDate(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(instant));
}

/** Ett klockslag på ett visst datum i tävlingens tidszon som ISO-ögonblick; regeln finns i domänen. */
export { parseRaceClock } from "@o-tid/domain";
