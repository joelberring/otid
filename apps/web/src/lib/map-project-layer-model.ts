import { SYMBOL_SETS } from "@o-tid/map-file";
import type { CatalogSymbol, SymbolGroup } from "./map-project-protocol";

/**
 * Ägaren 2026-11-09: lagerhanteringen bygger på normen (ISOM 2017-2 eller ISSprOM 2019-2 efter kartans skala), så att målet
 * – en karta som följer normen – syns i lagren. Huvudlagren är normens grupper (landformer, berg, vatten …) med symbolerna
 * som underlager; symboler som inte finns i normen (äldre normer, egna symboler, sammanslagna kartor) ligger i ett eget lager
 * "Utanför normen" och kan slås ihop med en symbol i normen. Ett lager kan tändas och släckas, låsas (det går inte att markera
 * eller ändra) och ett låst lager visas fullt eller nedtonat. Valen sparas i webbläsaren per projekt.
 */
export type LayerId = SymbolGroup | "OUTSIDE";
export const LAYER_ORDER: readonly LayerId[] = ["LANDFORMS", "ROCK", "WATER", "VEGETATION", "MANMADE", "TECHNICAL", "COURSE", "OTHER", "OUTSIDE"];
export interface LayerFlags { readonly hidden?: boolean; readonly locked?: boolean; readonly dimmed?: boolean }
export interface LayerState {
  readonly layers: Readonly<Partial<Record<LayerId, LayerFlags>>>;
  /** Underlager: en symbol (id) med egna val; saknas = som lagret. */
  readonly symbols: Readonly<Record<string, LayerFlags>>;
  /** Lagren fas 2: arbetslagrens och skisslagrens val (lagrets id). */
  readonly work?: Readonly<Record<string, LayerFlags>> | undefined;
}
/** Ett arbetslager: normens symbolnummer i en egen grupp. */
export interface WorkLayer { readonly layerId: string; readonly codes: readonly string[] }
export const EMPTY_LAYERS: LayerState = { layers: {}, symbols: {} };
export type Standard = "ISOM" | "ISSPROM";

/** Normen för kartans skala (sprint upp till 1:5 000). */
export const standardFor = (scale: number | undefined): Standard => scale !== undefined && scale > 0 && scale <= 5000 ? "ISSPROM" : "ISOM";

/** Normens symbolnummer och namn (`406`, `406.1` …). */
export function standardSymbols(standard: Standard): ReadonlyMap<string, string> {
  const set = standard === "ISSPROM" ? SYMBOL_SETS["ISSPROM2019-2"] : SYMBOL_SETS["ISOM2017-2"];
  return new Map(set.symbols.map(symbol => [symbol.code, symbol.name]));
}

/** Symbolnumret utan ".0" (filernas "406.0" är normens "406"). */
export const normalCode = (code: string) => code.replace(/\.0+$/, "").trim();

/** Lagret för en symbol: utanför normen om numret inte finns i normen, annars normens grupp. */
export function layerOf(symbol: Pick<CatalogSymbol, "code" | "group">, standard: ReadonlyMap<string, string>): LayerId {
  return standard.has(normalCode(symbol.code)) ? symbol.group : "OUTSIDE";
}

export interface LayerRow { readonly id: LayerId; readonly symbols: readonly CatalogSymbol[]; readonly count: number; readonly flags: LayerFlags }

/** Lagren med sina symboler (bara de som finns i kartfilen), i normens ordning. */
export function layerRows(catalog: readonly CatalogSymbol[], standard: ReadonlyMap<string, string>, state: LayerState): LayerRow[] {
  return LAYER_ORDER.flatMap(id => {
    const symbols = catalog.filter(symbol => symbol.kind !== "text" && layerOf(symbol, standard) === id);
    return symbols.length ? [{ id, symbols, count: symbols.reduce((sum, symbol) => sum + symbol.count, 0), flags: state.layers[id] ?? {} }] : [];
  });
}

/**
 * En symbols val: underlagrets egna, annars arbetslagrens (släckt, låst eller tonat om något arbetslager med symbolen är det),
 * annars huvudlagrets.
 */
export function symbolFlags(symbol: CatalogSymbol, standard: ReadonlyMap<string, string>, state: LayerState,
  work: readonly WorkLayer[] = []): Required<LayerFlags> {
  const layer = state.layers[layerOf(symbol, standard)] ?? {}, own = state.symbols[symbol.id] ?? {};
  const code = normalCode(symbol.code);
  const groups = work.filter(row => row.codes.includes(code)).map(row => state.work?.[row.layerId] ?? {});
  const grouped = (flag: keyof LayerFlags) => groups.some(flags => flags[flag] === true) ? true : undefined;
  return { hidden: own.hidden ?? grouped("hidden") ?? layer.hidden ?? false, locked: own.locked ?? grouped("locked") ?? layer.locked ?? false,
    dimmed: own.dimmed ?? grouped("dimmed") ?? layer.dimmed ?? false };
}

/** Ett val för ett arbetslager eller skisslager. */
export function withWorkFlag(state: LayerState, layerId: string, flag: keyof LayerFlags, value: boolean): LayerState {
  return { ...state, work: { ...state.work, [layerId]: { ...state.work?.[layerId], [flag]: value } } };
}

/** Symbolerna (id) som är släckta, låsta och låsta och nedtonade. */
export function layerSymbols(catalog: readonly CatalogSymbol[], standard: ReadonlyMap<string, string>, state: LayerState, work: readonly WorkLayer[] = []) {
  const hidden: string[] = [], locked: string[] = [], dimmed: string[] = [];
  for (const symbol of catalog) {
    const flags = symbolFlags(symbol, standard, state, work);
    if (flags.hidden) hidden.push(symbol.id);
    else if (flags.locked) { locked.push(symbol.id); if (flags.dimmed) dimmed.push(symbol.id); }
  }
  return { hidden, locked, dimmed };
}

/** Ett val för ett lager (underlagren följer lagret: deras egna val för samma sak tas bort). */
export function withLayerFlag(state: LayerState, catalog: readonly CatalogSymbol[], standard: ReadonlyMap<string, string>, id: LayerId,
  flag: keyof LayerFlags, value: boolean): LayerState {
  const symbols: Record<string, LayerFlags> = {};
  for (const [key, flags] of Object.entries(state.symbols)) {
    const symbol = catalog.find(row => row.id === key);
    if (symbol && layerOf(symbol, standard) === id) {
      const rest: { -readonly [K in keyof LayerFlags]: LayerFlags[K] } = { ...flags };
      delete rest[flag];
      if (Object.keys(rest).length) symbols[key] = rest;
    } else symbols[key] = flags;
  }
  return { layers: { ...state.layers, [id]: { ...state.layers[id], [flag]: value } }, symbols };
}

export function withSymbolFlag(state: LayerState, id: string, flag: keyof LayerFlags, value: boolean): LayerState {
  return { ...state, symbols: { ...state.symbols, [id]: { ...state.symbols[id], [flag]: value } } };
}

export interface MergeSuggestion {
  readonly from: CatalogSymbol; readonly to: CatalogSymbol;
  readonly reason: "SAME_CODE" | "SAME_NAME";
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase() && a.trim() !== "";

/**
 * Förslag på symboler att slå ihop: samma nummer (t.ex. två kartor med var sin 406) eller samma namn, med samma slag
 * (linje, yta, punkt). Den som följer normen och har flest objekt behålls; den andra går upp i den.
 */
export function mergeSuggestions(catalog: readonly CatalogSymbol[], standard: ReadonlyMap<string, string>): MergeSuggestion[] {
  const usable = catalog.filter(symbol => symbol.kind !== "text");
  const rank = (symbol: CatalogSymbol) => (standard.has(normalCode(symbol.code)) ? 1_000_000 : 0) + symbol.count;
  const out: MergeSuggestion[] = [], used = new Set<string>();
  for (const a of usable) {
    for (const b of usable) {
      if (a.id >= b.id || a.kind !== b.kind || used.has(a.id) || used.has(b.id)) continue;
      const reason = normalCode(a.code) === normalCode(b.code) && normalCode(a.code) !== "" ? "SAME_CODE" : sameName(a.name, b.name) ? "SAME_NAME" : undefined;
      if (!reason || (a.count === 0 && b.count === 0)) continue;
      const [to, from] = rank(a) >= rank(b) ? [a, b] : [b, a];
      if (from.count === 0) continue;
      used.add(from.id);
      out.push({ from, to, reason });
    }
  }
  return out;
}

const storageKey = (projectId: string) => `otid-map-layers:${projectId}`;
export function readLayerState(projectId: string): LayerState {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(projectId)) ?? "null") as LayerState | null;
    return value && typeof value === "object" && value.layers && value.symbols ? value : EMPTY_LAYERS;
  } catch { return EMPTY_LAYERS; }
}
export function saveLayerState(projectId: string, state: LayerState): void {
  try { localStorage.setItem(storageKey(projectId), JSON.stringify(state)); } catch { /* utan lagring: bara den här sidan */ }
}
