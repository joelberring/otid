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
export { parseRaceClock, parseRaceClockNear } from "@o-tid/domain";

/**
 * Steg 58: referensen för ett klockslag som skrivs för en löpare: den tidigaste kända starten i klassen, annars i hela
 * tävlingen. En start kl 00:20 i en nattklass med första start 22:00 blir då natten efter, inte morgonen före.
 */
export function startReference(entries: readonly { readonly classId: string; readonly fixedStartTime?: string | null }[],
  classId?: string): string | undefined {
  const earliest = (rows: typeof entries) => rows.flatMap((row) => row.fixedStartTime ? [row.fixedStartTime] : [])
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
  return (classId ? earliest(entries.filter((row) => row.classId === classId)) : undefined) ?? earliest(entries);
}
