/** Svensk sortering (å, ä, ö sist; siffror i nummerordning) och sökning utan hänsyn till skiftläge och accenter. */
const collator = new Intl.Collator("sv-SE", { numeric: true, sensitivity: "base" });

export const compareText = (a: string, b: string) => collator.compare(a, b);

export function searchable(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("sv-SE");
}

/** Sant om något av fälten innehåller söktexten (redan gjord sökbar). */
export function matches(needle: string, ...fields: (string | null | undefined)[]): boolean {
  return fields.some(field => field && searchable(field).includes(needle));
}
