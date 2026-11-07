/**
 * Symbolfilter för träningsläget (ADR-0192 beslut 4). Kartans symboler grupperas efter huvudnumret i ISOM 2017-2 och
 * ISSprOM 2019-2 (numren kontrollerade mot omapwiki.orienteering.sport 2026-11-01, samma källa som `detail-symbols.ts`);
 * ISOM 2000 har samma hundratal. Okända nummer grupperas efter symbolens namn, annars "Övrigt".
 */
import type { MapSymbol, ParsedMap, SymbolCode } from "@o-tid/map-file";
import type { FilterPreset, SymbolFilter, SymbolGroup } from "./training-types";

export const SYMBOL_GROUPS: readonly SymbolGroup[] = ["LANDFORM", "ROCK", "WATER", "VEGETATION", "PATHS", "MANMADE", "FORBIDDEN", "TECHNICAL", "OTHER"];

/** Grupperna som alltid syns i förvalen (nordlinjer, passmärken och förbjudet område: säkerheten). */
const KEPT: readonly SymbolGroup[] = ["TECHNICAL", "FORBIDDEN"];

export const FILTER_PRESETS: Readonly<Record<Exclude<FilterPreset, "CUSTOM">, readonly SymbolGroup[]>> = {
  ALL: SYMBOL_GROUPS,
  CONTOURS: ["LANDFORM", ...KEPT],
  CONTOURS_WATER_ROCK: ["LANDFORM", "ROCK", "WATER", ...KEPT],
  NO_VEGETATION: SYMBOL_GROUPS.filter(group => group !== "VEGETATION"),
  NO_PATHS: SYMBOL_GROUPS.filter(group => group !== "PATHS"),
  PATHS_ROADS: ["PATHS", ...KEPT]
};

/** Filtret för ett förval. */
export function presetFilter(preset: Exclude<FilterPreset, "CUSTOM">): SymbolFilter {
  return { preset, groups: [...FILTER_PRESETS[preset]], hide: [], show: [] };
}

/** Sant när filtret visar allt (inga dolda grupper eller symboler). */
export function isFullFilter(filter: SymbolFilter): boolean {
  return filter.hide.length === 0 && SYMBOL_GROUPS.every(group => filter.groups.includes(group));
}

/** Namnets ord per grupp (svenska och engelska), i den ordning de prövas. */
const NAME_RULES: readonly [SymbolGroup, RegExp][] = [
  ["FORBIDDEN", /förbjud|forbidden|out.of.bounds|shall not be entered|olovlig/i],
  ["TECHNICAL", /norrlinj|nordlinj|north|magnet|passm|registration|höjdsiffr|spot height/i],
  ["PATHS", /\b(väg|stig|path|road|track|trail|ride|rågång)|väg\b|stig\b|gångväg|cykelväg/i],
  ["MANMADE", /hus|building|byggnad|mur\b|wall|staket|fence|ledning|power|järnväg|railway|bro\b|bridge|torn|tower|ruin|trappa|stair/i],
  ["WATER", /vatten|water|sjö|lake|bäck|stream|dike|ditch|sank|marsh|kärr|myr|brunn|well|källa|spring/i],
  ["ROCK", /sten|boulder|berg|cliff|rock|brant|block|häll|grotta|cave/i],
  ["LANDFORM", /kurv|contour|form.?line|höjd|slänt|knoll|kulle|grop|depression|gully|fåra|jordvall|earth|terräng|landform|pit\b/i],
  ["VEGETATION", /skog|forest|veg|öppen|open|åker|tomt|grön|green|buske|bush|träd|tree|thicket|snår|odlad|cultivat/i]
];

/** Gruppen för en symbol: huvudnumret, annars namnet, annars "Övrigt". */
export function symbolGroup(code: SymbolCode, name: string): SymbolGroup {
  const main = code.main;
  if (main >= 101 && main <= 199) return "LANDFORM";
  if (main >= 201 && main <= 299) return "ROCK";
  if (main >= 301 && main <= 399) return "WATER";
  if (main >= 401 && main <= 499) return "VEGETATION";
  if (main >= 501 && main <= 508) return "PATHS";
  // 509: järnväg i ISOM 2017-2 och ISSprOM, rågång i ISOM 2000 (namnet avgör).
  if (main === 509) return /ride|rågång|linear trace|gata|stig/i.test(name) ? "PATHS" : "MANMADE";
  if (main === 520) return "FORBIDDEN";
  if (main >= 510 && main <= 599) return "MANMADE";
  if (main >= 601 && main <= 699) return "TECHNICAL";
  if (main >= 701 && main <= 799) return "FORBIDDEN";
  for (const [group, pattern] of NAME_RULES) if (pattern.test(name)) return group;
  return "OTHER";
}

/** Symbolens nyckel i filtret: numret som i filen, annars namnet. */
export function symbolKey(symbol: Pick<MapSymbol, "code" | "name">): string {
  const text = symbol.code.text.trim();
  return text !== "" ? text : `namn:${symbol.name}`;
}

/** Sant när filtret visar symbolen. */
export function filterShows(filter: SymbolFilter, key: string, group: SymbolGroup): boolean {
  if (filter.show.includes(key)) return true;
  if (filter.hide.includes(key)) return false;
  return filter.groups.includes(group);
}

/** Id för kartans symboler som något av filtren döljer. */
export function hiddenSymbolIds(map: Pick<ParsedMap, "symbols">, filters: readonly SymbolFilter[]): Set<string> {
  const out = new Set<string>();
  if (filters.every(isFullFilter)) return out;
  for (const symbol of map.symbols.values()) {
    const key = symbolKey(symbol);
    const group = symbolGroup(symbol.code, symbol.name);
    if (filters.some(filter => !filterShows(filter, key, group))) out.add(symbol.id);
  }
  return out;
}

export interface SymbolCatalogEntry {
  readonly key: string;
  readonly code: string;
  readonly name: string;
  readonly group: SymbolGroup;
  /** Antal objekt i kartan. */
  readonly count: number;
}

/** Kartans använda symboler med grupp och antal objekt, i nummerordning (editorns val per symbol). */
export function symbolCatalog(map: Pick<ParsedMap, "symbols" | "objects">): SymbolCatalogEntry[] {
  const counts = new Map<string, number>();
  for (const object of map.objects) counts.set(object.symbol, (counts.get(object.symbol) ?? 0) + 1);
  const byKey = new Map<string, SymbolCatalogEntry>();
  for (const [id, count] of counts) {
    const symbol = map.symbols.get(id);
    if (!symbol) continue;
    const key = symbolKey(symbol);
    const known = byKey.get(key);
    byKey.set(key, known ? { ...known, count: known.count + count }
      : { key, code: symbol.code.text.trim(), name: symbol.name, group: symbolGroup(symbol.code, symbol.name), count });
  }
  return [...byKey.values()].sort((a, b) => a.code.localeCompare(b.code, "sv-SE", { numeric: true }) || a.name.localeCompare(b.name, "sv-SE"));
}

/** Filtret med en grupp på eller av (förvalet blir "Eget"). */
export function toggleGroup(filter: SymbolFilter, group: SymbolGroup, on: boolean): SymbolFilter {
  const groups = on ? [...new Set([...filter.groups, group])] : filter.groups.filter(item => item !== group);
  return { ...filter, preset: "CUSTOM", groups: SYMBOL_GROUPS.filter(item => groups.includes(item)) };
}

/** Filtret med en symbol uttryckligen synlig eller dold (eller som gruppen, `undefined`). */
export function setSymbol(filter: SymbolFilter, key: string, visible: boolean | undefined): SymbolFilter {
  const hide = filter.hide.filter(item => item !== key);
  const show = filter.show.filter(item => item !== key);
  if (visible === true) show.push(key);
  if (visible === false) hide.push(key);
  return { ...filter, preset: "CUSTOM", hide, show };
}
