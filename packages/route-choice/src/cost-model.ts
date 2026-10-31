/**
 * Steg 60: kostnadsmodellen. Varje kartobjekt slås upp till en klass (tävlingens tabell, sedan standardtabellen, exakt
 * nummer och sedan huvudnummer) och ett lager, och dess geometri plattas till polylinjer i kartans mm en gång per karta.
 * Rutnätet per sträcka byggs ur de här förberedda objekten (`raster.ts`).
 */
import { flattenPath, type MapObject, type MapSymbol, type ParsedMap, type Path, type Point, type PointElement } from "@o-tid/map-file";
import {
  BRIDGEABLE_SYMBOLS, classForCode, CONTOUR_SYMBOLS, CROSSING_SYMBOLS, FORM_LINE_SYMBOLS, isTrackSymbol, resolveSettings,
  type ResolvedSettings, type RunnableClass
} from "./defaults";
import type { CostModel, RouteChoiceSettings, SpeedClass } from "./types";

/**
 * Lager i rutnätet: AREA = vegetation och mark (långsammaste vinner), TRACK = vägar och stigar (snabbt lager ovanpå),
 * BLOCK = ej passerbart, WATER = ej passerbart som vägar och broar får korsa, CROSSING = öppnar ej passerbart,
 * CONTOUR/FORM_LINE = höjdkurvor för stigningen.
 */
export type Layer = "AREA" | "TRACK" | "BLOCK" | "WATER" | "CROSSING" | "CONTOUR" | "FORM_LINE";

/** Ett förberett kartobjekt. `polygons` fylls (jämn–udda, så hål respekteras); `lines` stryks med `radius` mm. */
export interface Feature {
  readonly layer: Layer;
  /** Klassen för AREA och TRACK. */
  readonly cls: RunnableClass;
  readonly polygons: readonly (readonly Point[])[][];
  readonly lines: readonly (readonly Point[])[];
  /** Halva linjebredden i mm (0 = så smalt som rutnätet tillåter). */
  readonly radius: number;
  readonly box: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
}

export interface SymbolClassRow {
  readonly code: string;
  readonly name: string;
  readonly cls: SpeedClass | null;
  /** OWN = tävlingens tabell, STANDARD = standardtabellen, INHERITED = från delarna (Mapper), UNKNOWN = saknas. */
  readonly source: "OWN" | "STANDARD" | "INHERITED" | "UNKNOWN";
  readonly objects: number;
}

export interface PreparedModel {
  readonly settings: ResolvedSettings;
  readonly features: readonly Feature[];
  readonly scale: number;
  /** Kartans yta (objektens ruta); utanför den finns ingen karta och ingen väg. */
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } | null;
}

const prepared = new WeakMap<CostModel, PreparedModel>();

/** Den förberedda modellen bakom `CostModel` (byggs om ifall någon skickar in en egen). */
export function preparedOf(model: CostModel, settings?: RouteChoiceSettings | null): PreparedModel {
  const known = prepared.get(model);
  if (known) return known;
  const built = buildCostModel(model.map, settings);
  return prepared.get(built)!;
}

interface Role { readonly layer: Layer | null; readonly cls: SpeedClass | null; readonly source: SymbolClassRow["source"]; readonly main: number }

function classOf(symbol: MapSymbol, settings: ResolvedSettings, symbols: ReadonlyMap<string, MapSymbol>, depth = 0): { cls: SpeedClass | null; main: number; inherited: boolean } {
  const own = classForCode(settings, symbol.code);
  if (own) return { cls: own, main: symbol.code.main, inherited: false };
  if (symbol.kind === "COMBINED" && depth < 4) {
    // Den mest hindrande delen gäller (ej passerbart före långsamt före snabbt); IGNORE bara om alla delar är det.
    let best: { cls: SpeedClass | null; main: number } | null = null;
    for (const id of symbol.parts) {
      const part = symbols.get(id);
      if (!part) continue;
      const found = classOf(part, settings, symbols, depth + 1);
      if (found.cls && (!best || restrictiveness(found.cls, settings) > restrictiveness(best.cls!, settings))) best = found;
    }
    if (best) return { ...best, inherited: true };
  }
  return { cls: null, main: symbol.code.main, inherited: false };
}

function restrictiveness(cls: SpeedClass, settings: ResolvedSettings): number {
  if (cls === "IMPASSABLE") return 1e9;
  if (cls === "IGNORE") return -1e9;
  return -settings.speedByClass[cls];
}

function roleOf(symbol: MapSymbol, settings: ResolvedSettings, symbols: ReadonlyMap<string, MapSymbol>): Role {
  const { cls, main, inherited } = classOf(symbol, settings, symbols);
  const source: SymbolClassRow["source"] = cls === null ? "UNKNOWN" : inherited ? "INHERITED"
    : lookupIsOwn(settings, symbol) ? "OWN" : "STANDARD";
  const code = symbol.code.main;
  if (CONTOUR_SYMBOLS.includes(code)) return { layer: "CONTOUR", cls, source, main };
  if (FORM_LINE_SYMBOLS.includes(code)) return { layer: "FORM_LINE", cls, source, main };
  if (CROSSING_SYMBOLS.includes(code)) return { layer: "CROSSING", cls, source, main };
  if (cls === null || cls === "IGNORE") return { layer: null, cls, source, main };
  if (cls === "IMPASSABLE") return { layer: BRIDGEABLE_SYMBOLS.includes(main) ? "WATER" : "BLOCK", cls, source, main };
  if (isTrackSymbol(main)) return { layer: "TRACK", cls, source, main };
  return { layer: "AREA", cls, source, main };
}

function lookupIsOwn(settings: ResolvedSettings, symbol: MapSymbol): boolean {
  const table = settings.classBySymbol;
  const { text, main, sub } = symbol.code;
  return table[text.trim()] !== undefined || table[`${main}.${sub}`] !== undefined || table[String(main)] !== undefined;
}

/** Halva bredden (mm) som linjesymbolen täcker: största |förskjutning| + halva streckbredden. */
function halfWidth(symbol: MapSymbol | undefined, symbols: ReadonlyMap<string, MapSymbol>, depth = 0): number {
  if (!symbol) return 0;
  if (symbol.kind === "LINE") return symbol.strokes.reduce((max, stroke) => Math.max(max, Math.abs(stroke.offset ?? 0) + stroke.width / 2), 0);
  if (symbol.kind === "COMBINED" && depth < 4) {
    return symbol.parts.reduce((max, id) => Math.max(max, halfWidth(symbols.get(id), symbols, depth + 1)), 0);
  }
  if (symbol.kind === "AREA") return (symbol.border ?? []).reduce((max, stroke) => Math.max(max, stroke.width / 2), 0);
  return 0;
}

function pointElements(symbol: MapSymbol | undefined, symbols: ReadonlyMap<string, MapSymbol>, depth = 0): PointElement[] {
  if (!symbol) return [];
  if (symbol.kind === "POINT") return [...symbol.elements];
  if (symbol.kind === "COMBINED" && depth < 4) return symbol.parts.flatMap(id => pointElements(symbols.get(id), symbols, depth + 1));
  return [];
}

function boxOf(polygons: readonly (readonly Point[])[][], lines: readonly (readonly Point[])[], pad: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (points: readonly Point[]) => {
    for (const p of points) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  };
  for (const polygon of polygons) for (const ring of polygon) add(ring);
  for (const line of lines) add(line);
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function flatten(path: Path): Point[][] {
  return flattenPath(path).filter(line => line.length > 0);
}

function closeRing(ring: Point[]): Point[] {
  if (ring.length > 1) {
    const first = ring[0]!, last = ring[ring.length - 1]!;
    if (first.x !== last.x || first.y !== last.y) return [...ring, first];
  }
  return ring;
}

/** Punktsymbolens element som ytor och linjer på kartan (vridna moturs med objektets vinkel). */
function placePoint(elements: readonly PointElement[], at: Point, angleDegrees: number) {
  const radians = angleDegrees * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const place = (p: Point): Point => ({ x: at.x + p.x * cos - p.y * sin, y: at.y + p.x * sin + p.y * cos });
  const polygons: Point[][][] = [];
  const lines: { points: Point[]; radius: number }[] = [];
  for (const element of elements) {
    if (element.kind === "area") polygons.push(element.rings.flatMap(ring => flatten(ring)).map(ring => closeRing(ring.map(place))));
    else if (element.kind === "line") for (const line of flatten(element.path)) lines.push({ points: line.map(place), radius: element.width / 2 });
    else if (element.kind === "dot") lines.push({ points: [place(element.center)], radius: element.diameter / 2 });
    else lines.push({ points: [place(element.center)], radius: element.diameter / 2 + element.lineWidth / 2 });
  }
  return { polygons, lines };
}

function prepareObject(object: MapObject, symbol: MapSymbol, role: Role & { layer: Layer }, symbols: ReadonlyMap<string, MapSymbol>): Feature[] {
  const cls: RunnableClass = role.cls && role.cls !== "IMPASSABLE" && role.cls !== "IGNORE" ? role.cls : "NORMAL";
  if (object.kind === "text") return [];
  if (object.kind === "area") {
    const polygons = [object.rings.flatMap(ring => flatten(ring)).map(closeRing)];
    return [{ layer: role.layer, cls, polygons, lines: [], radius: 0, box: boxOf(polygons, [], 0) }];
  }
  if (object.kind === "line") {
    const lines = flatten(object.path);
    const radius = halfWidth(symbol, symbols);
    return [{ layer: role.layer, cls, polygons: [], lines, radius, box: boxOf([], lines, radius) }];
  }
  const placed = placePoint(pointElements(symbol, symbols), object.at, object.angle);
  const out: Feature[] = [];
  if (placed.polygons.length > 0) out.push({ layer: role.layer, cls, polygons: placed.polygons, lines: [], radius: 0, box: boxOf(placed.polygons, [], 0) });
  for (const line of placed.lines) out.push({ layer: role.layer, cls, polygons: [], lines: [line.points], radius: line.radius, box: boxOf([], [line.points], line.radius) });
  // En punktsymbol utan ritdata (t.ex. genomgång utan grafik) får en liten yta så att den ändå verkar.
  if (out.length === 0) out.push({ layer: role.layer, cls, polygons: [], lines: [[object.at]], radius: 0.25, box: boxOf([], [[object.at]], 0.25) });
  return out;
}

export interface BuiltCostModel extends CostModel {
  /** Klass per använd symbol, för tabellen där arrangören kan ändra klassen. */
  readonly classes: readonly SymbolClassRow[];
}

/**
 * Bygger kostnadsmodellen en gång per karta och inställning. Dolda symboler (som inte trycks) räknas inte: analysen
 * använder bara det de tävlande ser. Klasserna bakas in här; farter, ekvidistans och stigning läses ur inställningarna
 * vid varje `analyseLeg`.
 */
export function buildCostModel(map: ParsedMap, settings?: RouteChoiceSettings | null): BuiltCostModel {
  const resolved = resolveSettings(settings);
  const roles = new Map<string, Role>();
  const counts = new Map<string, number>();
  const features: Feature[] = [];
  for (const object of map.objects) {
    const symbol = map.symbols.get(object.symbol);
    if (!symbol || symbol.hidden) continue;
    counts.set(symbol.id, (counts.get(symbol.id) ?? 0) + 1);
    let role = roles.get(symbol.id);
    if (!role) { role = roleOf(symbol, resolved, map.symbols); roles.set(symbol.id, role); }
    if (role.layer) features.push(...prepareObject(object, symbol, role as Role & { layer: Layer }, map.symbols));
  }
  const classes: SymbolClassRow[] = [];
  for (const [id, objects] of counts) {
    const symbol = map.symbols.get(id)!;
    const role = roles.get(id)!;
    classes.push({ code: symbol.code.text, name: symbol.name, cls: role.cls, source: role.source, objects });
  }
  classes.sort((a, b) => a.code.localeCompare(b.code, "sv", { numeric: true }));
  const unknownSymbols = classes.filter(row => row.source === "UNKNOWN" && !isTextSymbol(map, row.code))
    .map(row => ({ code: row.code, name: row.name, objects: row.objects }));
  const model: BuiltCostModel = { map, unknownSymbols, classes };
  prepared.set(model, { settings: resolved, features, scale: map.scale > 0 ? map.scale : 15000, bounds: map.bounds });
  return model;
}

function isTextSymbol(map: ParsedMap, code: string): boolean {
  for (const symbol of map.symbols.values()) if (symbol.code.text === code) return symbol.kind === "TEXT";
  return false;
}
