import type { StartCheckinRosterResponse } from "@o-tid/contracts";

function searchText(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("sv-SE");
}

/** Presentation only: never classify entries or change the server's order. */
export function filterForestWatchEntries(
  entries: StartCheckinRosterResponse["entries"], classId: string, query: string
): StartCheckinRosterResponse["entries"] {
  const needle = searchText(query.trim());
  return entries.filter((entry) => (!classId || entry.classId === classId) &&
    (!needle || [entry.displayName, entry.organisationName, entry.cardNumber]
      .some((value) => value !== null && searchText(value).includes(needle))));
}
