import type { PublicResultListResponse } from "@o-tid/contracts";

type PublicResultRow = PublicResultListResponse["results"][number];

export function normalizePublicResultSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("sv-SE").trim();
}

export function publicResultClassNames(rows: readonly PublicResultRow[]): string[] {
  return [...new Set(rows.map((row) => row.className))].sort((left, right) => left.localeCompare(right, "sv-SE"));
}

export function filterPublicResults(
  rows: readonly PublicResultRow[],
  query: string,
  className: string
): PublicResultRow[] {
  const normalizedQuery = normalizePublicResultSearch(query);
  return rows.filter((row) => {
    if (className !== "" && row.className !== className) return false;
    if (normalizedQuery === "") return true;
    return normalizePublicResultSearch(`${row.givenName} ${row.familyName} ${row.className}`).includes(normalizedQuery);
  });
}
