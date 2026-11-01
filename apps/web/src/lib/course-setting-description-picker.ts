import type { DescriptionBox, DescriptionLanguage, DescriptionSymbol } from "@o-tid/course-setting";

/**
 * Steg 63 (ADR-0180): väljaren för en ruta i kontrollbeskrivningen (C–H). Symbolerna för rutan kommer från
 * `symbolsForBox`; här filtreras de på namn (på valt språk) eller id, de senast använda kommer överst, F och G tar
 * även fri text ("2m", "4x4") och "Ingen" tömmer rutan. Tangenterna flyttar markeringen i listan.
 */
export const PICKER_BOXES = ["C", "D", "E", "F", "G", "H"] as const;
/** Rutan som får fri text i stället för en symbol (mått: "2m", "4x4", "0.5/3"); paketet tillåter text bara i F, som Purple Pen. */
export const TEXT_BOXES: readonly string[] = ["F"];
export const RECENT_COUNT = 6;

export const allowsText = (box: string) => TEXT_BOXES.includes(box);
/** C–H, och "all" för riktningsradens symbol (mål, passage, kartutdelning). */
export const isPickerBox = (box: string | undefined): box is string =>
  box !== undefined && (box === "all" || (PICKER_BOXES as readonly string[]).includes(box));

/** Symbolslaget för riktningsraden ("all") per kontrollslag, som Purple Pen: mål Z, passage X, kartutdelning V. */
const DIRECTIVE_KIND: Readonly<Record<string, string>> = { FINISH: "Z", CROSSING_POINT: "X", MAP_ISSUE: "V" };

/** Det som `symbolsForBox` ska fråga efter för en ruta på en kontroll av slaget (eller inget: rutan har inga symboler). */
export function symbolBoxFor(box: string, controlKind: string): string | undefined {
  if (box === "all") return DIRECTIVE_KIND[controlKind];
  return DIRECTIVE_KIND[controlKind] ? undefined : box;
}

export type PickerOption =
  | { readonly kind: "symbol"; readonly symbol: DescriptionSymbol; readonly name: string; readonly recent: boolean }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "none" };

/** Symbolens namn på språket, annars engelska, annars första som finns, annars id. */
export function symbolName(symbol: DescriptionSymbol, language: DescriptionLanguage): string {
  return symbol.names[language] ?? symbol.names.en ?? Object.values(symbol.names)[0] ?? symbol.id;
}

const fold = (value: string) => value.toLocaleLowerCase("sv-SE").trim();

/** Alla ord i sökningen finns i namnet, eller sökningen är början på symbolens id ("2.4", "5."). */
export function matches(symbol: DescriptionSymbol, name: string, query: string): boolean {
  const wanted = fold(query);
  if (!wanted) return true;
  if (symbol.id.toLowerCase().startsWith(wanted)) return true;
  const folded = fold(name);
  return wanted.split(/\s+/).every(word => folded.includes(word));
}

export function pickerOptions(symbols: readonly DescriptionSymbol[], input: {
  readonly box: string; readonly query: string; readonly recent: readonly string[]; readonly language: DescriptionLanguage;
}): PickerOption[] {
  const query = input.query.trim();
  const named = symbols.map(symbol => ({ symbol, name: symbolName(symbol, input.language) }))
    .filter(row => matches(row.symbol, row.name, query));
  const byId = new Map(named.map(row => [row.symbol.id, row]));
  const recent = input.recent.flatMap(id => byId.get(id) ? [byId.get(id)!] : []);
  const recentIds = new Set(recent.map(row => row.symbol.id));
  const options: PickerOption[] = [];
  if (query && allowsText(input.box)) options.push({ kind: "text", text: query });
  for (const row of recent) options.push({ kind: "symbol", symbol: row.symbol, name: row.name, recent: true });
  for (const row of named) if (!recentIds.has(row.symbol.id)) options.push({ kind: "symbol", symbol: row.symbol, name: row.name, recent: false });
  if (!query) options.push({ kind: "none" });
  return options;
}

/** Senast använda först, utan dubbletter, högst `max`. */
export function rememberRecent(recent: readonly string[], id: string, max = RECENT_COUNT): string[] {
  return [id, ...recent.filter(value => value !== id)].slice(0, max);
}

/** Tangent i listan: ny markerad rad (eller oförändrad för andra tangenter). Listan går runt. */
export function moveActive(active: number, key: string, count: number): number {
  if (count === 0) return 0;
  switch (key) {
    case "ArrowDown": return (active + 1) % count;
    case "ArrowUp": return (active - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    case "PageDown": return Math.min(count - 1, active + 8);
    case "PageUp": return Math.max(0, active - 8);
    default: return Math.min(Math.max(active, 0), count - 1);
  }
}

export const boxValue = (boxes: readonly DescriptionBox[], box: string) => boxes.find(row => row.box === box);

/** Kontrollens rutor med en ruta satt till en symbol, en text eller tömd (null), i rutornas ordning (för SET_DESCRIPTION). */
export function setBox(boxes: readonly DescriptionBox[], box: string, value: { readonly ref: string } | { readonly text: string } | null): DescriptionBox[] {
  const rest = boxes.filter(row => row.box !== box);
  const next = value === null ? rest : [...rest, { box, ...value }];
  return next.sort((left, right) => left.box === "all" ? -1 : right.box === "all" ? 1 : left.box.localeCompare(right.box));
}

/** Samma rutor (ordningen spelar ingen roll): då görs ingen ändring. */
export function sameBoxes(left: readonly DescriptionBox[], right: readonly DescriptionBox[]): boolean {
  const key = (rows: readonly DescriptionBox[]) => rows.map(row => `${row.box}|${row.ref ?? ""}|${row.text ?? ""}`).sort().join(";");
  return key(left) === key(right);
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const RECENT_KEY = "otid.course-setting.recent-symbols";

/** Senast använda per ruta, i webbläsaren (bekvämlighet; saknas lagringen börjar listan tom). */
export function readRecent(storage: Storage | undefined): Record<string, string[]> {
  try {
    const value: unknown = JSON.parse(storage?.getItem(RECENT_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([box, ids]) => [box, Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string").slice(0, RECENT_COUNT) : []]));
  } catch { return {}; }
}

export function writeRecent(storage: Storage | undefined, recent: Record<string, readonly string[]>): void {
  try { storage?.setItem(RECENT_KEY, JSON.stringify(recent)); } catch { /* Lagringen är full eller avstängd: listan glöms, inget annat händer. */ }
}
