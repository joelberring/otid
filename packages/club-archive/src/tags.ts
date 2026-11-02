/**
 * ADR-0194 beslut 6: föreslagna taggar ur mapp- och filnamnen. Orden följer träningsformerna i banläggningens träningsläge
 * (ADR-0192: korridor, fönster, kurvbild, linje, stjärna, keps, kartbitar, sista säkra, utan karta) och klubbens egna ord
 * (KepsOL, Rävorientering, Natt …). Taggarna är fri text och går att ändra i arkivet.
 */
export const TAG_RULES: readonly { readonly tag: string; readonly pattern: RegExp }[] = [
  { tag: "Keps", pattern: /keps|hatt-?o/ },
  { tag: "Rävorientering", pattern: /räv/ },
  { tag: "Sprint", pattern: /sprint/ },
  { tag: "Stjärna", pattern: /stjärn|stjarn/ },
  { tag: "Korridor", pattern: /korridor/ },
  { tag: "Kurvbild", pattern: /kurv/ },
  { tag: "Linje", pattern: /linje/ },
  { tag: "Fönster", pattern: /fönster|fonster/ },
  { tag: "Minnes", pattern: /minnes|minne-|pussel|kartbit/ },
  { tag: "Utan karta", pattern: /relä|kompass|utan karta/ },
  { tag: "Sista säkra", pattern: /sista säkra|attackpunkt/ },
  { tag: "Natt", pattern: /natt/ },
  { tag: "Stafett", pattern: /stafett/ },
  { tag: "Intervall", pattern: /intervall/ },
  { tag: "Vägval", pattern: /vägval|vagval/ },
  { tag: "Teknik", pattern: /teknik/ },
  { tag: "Tävling", pattern: /(^|[^a-zåäö])km([^a-zåäö]|$)|klubbmästerskap|tävling/ },
  { tag: "Ungdom", pattern: /ungdom|knatte/ }
];

/** Taggarna i regelordning för texterna (mappnamn och filnamn). */
export function suggestTags(texts: readonly string[]): string[] {
  const haystack = texts.map(text => text.normalize("NFC").toLowerCase()).join(" \n ");
  return TAG_RULES.filter(rule => rule.pattern.test(haystack)).map(rule => rule.tag);
}
