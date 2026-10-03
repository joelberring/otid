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
  paymentAttentionOnly: boolean;
  resultState: AdministratorRosterResultFilter;
};
export type AdministratorRosterOrder = "NAME" | "FIXED_START";

const searchText = (value: string) => value.normalize("NFC").toLocaleLowerCase("sv-SE").trim();

/** UNMARKED is unknown, not proven unpaid; both need an operator's review. */
export function needsPaymentAttention(status: unknown): boolean {
  return status === "UNMARKED" || status === "UNPAID";
}

export function missingFixedStartTime(entry: Entry, startRule: StartRule | undefined): boolean {
  return startRule === "FIXED" && entry.fixedStartTime === null;
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
    if (filters.paymentAttentionOnly && !needsPaymentAttention(entry.paymentStatus)) return false;
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
