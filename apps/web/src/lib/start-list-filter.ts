import type { StartListAdminListResponse, StartListPublicationContent } from "@o-tid/contracts";

function searchText(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("sv-SE");
}

/** Presentation only: retain the server's class and entry order. */
export function filterStartListClasses(
  classes: StartListAdminListResponse["classes"], classId: string, query: string
): StartListAdminListResponse["classes"] {
  const needle = searchText(query.trim());
  return classes.filter((row) => !classId || row.id === classId).map((row) => ({
    ...row,
    entries: row.entries.filter((entry) => !needle ||
      [entry.displayName, entry.organisationName, entry.cardNumber]
        .some((value) => value !== null && searchText(value).includes(needle)))
  }));
}

/** View-only filtering of frozen publication fields; never changes source order or content. */
export function filterPublishedStartListClasses(
  classes: StartListPublicationContent["classes"], classIndex: string, query: string
) {
  const needle = searchText(query.trim());
  return classes.flatMap((row, index) => {
    if (classIndex && classIndex !== String(index)) return [];
    const entries = needle ? row.entries.filter((entry) =>
      searchText(entry.displayName).includes(needle) ||
      (entry.organisationName !== null && searchText(entry.organisationName).includes(needle))) : row.entries;
    return needle && entries.length === 0 ? [] : [{ ...row, index, entries }];
  });
}
