/** Löptider, klockslag och datum i tävlingens tidszon, och klockslag som ISO-ögonblick; reglerna finns i domänen. */
export { formatClockTime, formatDuration, parseRaceClock, parseRaceClockNear, zonedDate } from "@o-tid/domain";

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
