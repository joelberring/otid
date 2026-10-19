import type { EntryTransferCandidates, SpeakerBoardEffectiveResult } from "@o-tid/contracts";

type Entry = EntryTransferCandidates["entries"][number];
type StartRule = EntryTransferCandidates["classes"][number]["startRule"];

export const administratorRosterResultFilters = ["ALL", "OK", "MP", "DNS", "DNF", "DSQ", "OOC", "NT",
  "NO_ACTIVE_RESULT", "NO_PUBLISHED_RESULT"] as const satisfies readonly ("ALL" | SpeakerBoardEffectiveResult["status"] |
    "NO_ACTIVE_RESULT" | "NO_PUBLISHED_RESULT")[];
export type AdministratorRosterResultFilter = typeof administratorRosterResultFilters[number];

export type AdministratorRosterFilter = {
  query: string;
  olderResultsOnly: boolean;
  rentalCardsOnly: boolean;
  resultState: AdministratorRosterResultFilter;
};
export type AdministratorRosterOrder = "NAME" | "FIXED_START";

const searchText = (value: string) => value.normalize("NFC").toLocaleLowerCase("sv-SE").trim();

/** Fast start utan tid. Stafettsträckor räknas inte: deras start ges av masstart, växling eller omstart. */
export function missingFixedStartTime(entry: Entry, startRule: StartRule | undefined): boolean {
  return startRule === "FIXED" && entry.fixedStartTime === null && entry.relay === undefined;
}

export function filterAdministratorRoster(
  entries: readonly Entry[],
  classNames: ReadonlyMap<string, string>,
  filters: AdministratorRosterFilter,
): Entry[] {
  const terms = searchText(filters.query).split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (filters.resultState !== "ALL" && (filters.resultState === "NO_ACTIVE_RESULT" ||
      filters.resultState === "NO_PUBLISHED_RESULT" ? entry.effectiveResult.state !== filters.resultState :
      entry.effectiveResult.state !== "ACTIVE_RESULT" || entry.effectiveResult.result.status !== filters.resultState)) return false;
    if (filters.olderResultsOnly && entry.resultFreshness !== "OLDER_SNAPSHOT") return false;
    if (filters.rentalCardsOnly && (entry.activeAssignment?.isRental !== true || entry.activeAssignment.rentalReturned)) return false;
    const haystack = searchText(`${entry.displayName} ${entry.organisationName ?? ""} ${classNames.get(entry.classId) ?? ""} ${entry.activeAssignment?.cardNumber ?? ""}`);
    return terms.every((term) => haystack.includes(term));
  });
}

/** The name option preserves the server's surname/given-name/ID order. */
export function orderAdministratorRoster(
  entries: readonly Entry[],
  classes: ReadonlyMap<string, { startRule: StartRule }>,
  order: AdministratorRosterOrder,
): Entry[] {
  if (order === "NAME") return [...entries];
  return entries.map((entry, index) => ({
    entry, index,
    startMs: classes.get(entry.classId)?.startRule === "FIXED" && entry.fixedStartTime !== null
      ? Date.parse(entry.fixedStartTime) : null,
  })).sort((left, right) => {
    if (left.startMs === null) return right.startMs === null ? left.index - right.index : 1;
    if (right.startMs === null) return -1;
    return left.startMs - right.startMs || left.index - right.index;
  }).map(({ entry }) => entry);
}

/** Ett lägesval i Anmäldas filter med antalet deltagare i läget. */
export type RosterStatusOption = { value: AdministratorRosterResultFilter; count: number };

const entryState = (entry: Entry): Exclude<AdministratorRosterResultFilter, "ALL"> =>
  entry.effectiveResult.state === "ACTIVE_RESULT" ? entry.effectiveResult.result.status : entry.effectiveResult.state;

/**
 * Statusvalen som är värda att visa (PLAN.md steg 24): "Alla" och de lägen som någon deltagare har, i filtrets ordning,
 * plus det valda även när det blivit tomt (annars försvinner valet under användaren).
 */
export function rosterStatusOptions(entries: readonly Entry[], selected: AdministratorRosterResultFilter): RosterStatusOption[] {
  const counts = new Map<AdministratorRosterResultFilter, number>();
  for (const entry of entries) counts.set(entryState(entry), (counts.get(entryState(entry)) ?? 0) + 1);
  return administratorRosterResultFilters.filter(value => value === "ALL" || value === selected || (counts.get(value) ?? 0) > 0)
    .map(value => ({ value, count: value === "ALL" ? entries.length : counts.get(value) ?? 0 }));
}
