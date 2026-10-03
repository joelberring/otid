import type { EntryTransferCandidates } from "@o-tid/contracts";

type Entry = Pick<EntryTransferCandidates["entries"][number], "id" | "classId" | "displayName" | "fixedStartTime">;
const names = new Intl.Collator("sv-SE", { sensitivity: "base" });

/** Presentation of a validated roster, not start-slot availability or a reservation. */
export function projectTargetClassStartTimes(entries: readonly Entry[], classId: string, proposedTime: string | null) {
  const rows: { id: string; displayName: string; fixedStartTime: string }[] = [];
  const missingRows: { id: string; displayName: string }[] = [];
  for (const entry of entries) {
    if (entry.classId !== classId) continue;
    if (entry.fixedStartTime === null) missingRows.push({ id: entry.id, displayName: entry.displayName });
    else rows.push({ id: entry.id, displayName: entry.displayName, fixedStartTime: entry.fixedStartTime });
  }
  rows.sort((a, b) => Date.parse(a.fixedStartTime) - Date.parse(b.fixedStartTime) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  missingRows.sort((a, b) => names.compare(a.displayName, b.displayName) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const instant = proposedTime === null ? null : Date.parse(proposedTime);
  return { rows, missingRows, missingTimeCount: missingRows.length,
    matchingTimeCount: instant === null ? 0 : rows.filter(row => Date.parse(row.fixedStartTime) === instant).length };
}
