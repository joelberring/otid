import type { EntryCardAdminListResponse } from "@o-tid/contracts";

function searchText(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("sv-SE");
}

/** Presentation only: retain server order and never select an entry. */
export function filterEntryCards(
  entries: EntryCardAdminListResponse["entries"], query: string
): EntryCardAdminListResponse["entries"] {
  const needle = searchText(query.trim());
  return entries.filter((entry) => !needle ||
    [entry.displayName, entry.className, entry.activeAssignment?.cardNumber]
      .some((value) => value !== undefined && searchText(value).includes(needle)));
}
