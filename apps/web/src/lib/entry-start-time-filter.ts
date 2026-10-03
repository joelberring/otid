import type { EntryStartTimeAdminListResponse } from "@o-tid/contracts";

function searchText(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("sv-SE");
}

/** Presentation only: preserve server order without selecting an entry. */
export function filterEntryStartTimes(
  entries: EntryStartTimeAdminListResponse["entries"], query: string
): EntryStartTimeAdminListResponse["entries"] {
  const needle = searchText(query.trim());
  return entries.filter((entry) => !needle ||
    [entry.displayName, entry.className].some((value) => searchText(value).includes(needle)));
}
