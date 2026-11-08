import {
  projectedToMapPoint, projectedToWgs84, wgs84ToMapPoint, type MapGeoreference, type MapObject, type PathCommand, type Point
} from "@o-tid/map-file";
import { LIMITS } from "./state";
import { stockholmLayer } from "./stockholm-layers";
import type { SourceData, SourceFeature, SourceGeometry } from "./vector-parse";

/**
 * ADR-0219 tillägget om vektorunderlagen (K4b): lagren i en vektorfil, förslag på symbol per lager, omräkningen till kartans mm
 * och städningen (utanför kartan, dubbletter, korta stumpar, linjer brutna i bitar). Resultatet blir kandidater som lämnas som
 * förslag; inget läggs direkt på kartan.
 */
export const WGS84_EPSG = 4326;
export type TargetKind = "point" | "line" | "area";

/** Källans punkt i kartans mm (samma system direkt, annars via WGS 84; EPSG:4326 är longitud, latitud). Kastar om systemet inte stöds. */
export function sourcePointToMap(georeference: MapGeoreference, crs: number, x: number, y: number): Point {
  if (crs === WGS84_EPSG) return wgs84ToMapPoint(georeference, { latitude: y, longitude: x });
  if (georeference.crs.kind === "EPSG" && georeference.crs.code === crs) return projectedToMapPoint(georeference, { easting: x, northing: y });
  return wgs84ToMapPoint(georeference, projectedToWgs84({ kind: "EPSG", code: crs }, x, y));
}

export interface ImportLayer {
  readonly name: string; readonly count: number;
  readonly points: number; readonly lines: number; readonly closedLines: number; readonly areas: number;
}

/** Lagren i filen, i den ordning de först förekommer. */
export function importLayers(data: SourceData): ImportLayer[] {
  const layers = new Map<string, { points: number; lines: number; closedLines: number; areas: number }>();
  for (const { layer, geometry } of data.features) {
    const row = layers.get(layer) ?? { points: 0, lines: 0, closedLines: 0, areas: 0 };
    if (geometry.kind === "point") row.points += 1;
    else if (geometry.kind === "area") row.areas += 1;
    else if (geometry.closed) row.closedLines += 1; else row.lines += 1;
    layers.set(layer, row);
  }
  return [...layers].map(([name, row]) => ({ name, count: row.points + row.lines + row.closedLines + row.areas, ...row }));
}

/** Koordinatsystemet ur koordinaternas storlek (östlig, nordlig): WGS 84, SWEREF 99 TM eller RT 90. Undefined om det inte går att säga. */
export function guessCrs(data: SourceData): number | undefined {
  const first = data.features[0]?.geometry;
  const at = !first ? undefined : first.kind === "point" ? first.at : first.kind === "line" ? first.points[0] : first.rings[0]?.[0];
  if (!at) return undefined;
  const [x, y] = at;
  if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return WGS84_EPSG;
  if (y > 6_100_000 && y < 7_700_000) {
    if (x > 1_100_000 && x < 2_000_000) return 3021;
    if (x > 250_000 && x < 950_000) return 3006;
  }
  return undefined;
}

/** Ord i lagrets namn (versaler, utan å, ä och ö) → symbolens nummer, som i plandokumentet för baskartorna. Första träffen gäller. */
const KEYWORDS: readonly { readonly words: RegExp; readonly line?: string; readonly area?: string; readonly point?: string }[] = [
  { words: /SKARMTAK|CANOPY/, area: "522" },
  { words: /HUS|BYGG|FASAD|BUILDING/, area: "521" },
  { words: /STAKET|STANGSEL|FENCE/, line: "516" },
  { words: /STODMUR|STENMUR|MUR|WALL/, line: "513" },
  { words: /TRAPP|STAIR|STEPS/, line: "532" },
  { words: /KANTST|CURB|KERB/, line: "501.1" },
  { words: /JARNVAG|RAIL|SPARVAG/, line: "509" },
  { words: /KRAFTLED|POWER/, line: "510" },
  { words: /GANGVAG|STIG|FOOTWAY|PATH/, line: "505" },
  { words: /PARKERING|ASFALT|PAVED|PARKING/, area: "501" },
  { words: /VAG|GATA|ROAD|STREET/, line: "503" },
  { words: /DIKE|DITCH|BACK|STREAM/, line: "305" },
  { words: /VATTEN|SJO|LAKE|WATER/, area: "301" },
  // Karttapullautins lager (K5): stödkurvor, slänt, branter och småknollar före de vanliga kurvorna.
  { words: /CONTOUR_INDEX|INDEXKURVA/, line: "102" },
  { words: /CONTOUR_INTERMED|DEPRESSION_INTERMED|FORMLINE|STODKURVA/, line: "103" },
  { words: /SLOPE_LINE/, line: "104" },
  { words: /CLIFF3/, line: "201" },
  { words: /CLIFF2|CLIFF/, line: "202" },
  { words: /DOTKNOLL/, point: "109" },
  { words: /HOJDKURVA|KURVA|CONTOUR|DEPRESSION/, line: "101" },
  { words: /TRAD|TREE/, point: "417" }
];
const normalized = (name: string) => name.toUpperCase().replace(/[ÅÄ]/g, "A").replace(/Ö/g, "O");

/** Förslag på symbol för ett lager: ur namnet och lagrets vanligaste form (slutna linjer kan bli ytor). */
export function suggestSymbol(layer: ImportLayer, symbols: readonly { readonly id: string; readonly code: string; readonly kind: string }[])
  : string | undefined {
  const wanted: TargetKind[] = layer.points >= layer.lines + layer.closedLines + layer.areas ? ["point"]
    : layer.areas + layer.closedLines > layer.lines ? ["area", "line"] : ["line", "area"];
  const pick = (codes: Partial<Record<TargetKind, readonly string[]>>) => {
    for (const kind of wanted) {
      for (const code of codes[kind] ?? []) {
        const symbol = symbols.find(row => row.kind === kind && (row.code === code || row.code === `${code}.0`));
        if (symbol) return symbol.id;
      }
    }
    return undefined;
  };
  // K6b: Stockholms baskarta och parkkarta (lagernamnens grammatik), annars orden i namnet.
  const stockholm = stockholmLayer(layer.name);
  if (stockholm) return stockholm.kind === "skip" ? undefined : pick(stockholm.rule);
  const name = normalized(layer.name);
  const rule = KEYWORDS.find(row => row.words.test(name));
  if (!rule) return undefined;
  return pick({ line: rule.line ? [rule.line] : [], area: rule.area ? [rule.area] : [], point: rule.point ? [rule.point] : [] });
}

export interface ImportOptions {
  /** Lager → symbol (id och form); lager som saknas hoppas över. */
  readonly mapping: ReadonlyMap<string, { readonly symbol: string; readonly kind: TargetKind }>;
  readonly toMap: (x: number, y: number) => Point;
  /** Kartans utbredning i mm: objekten klipps mot den, och det som ligger helt utanför hoppas över. */
  readonly bounds?: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } | undefined;
  /** Kortare linjer (mm) hoppas över; förval 0,3 mm. */
  readonly minLengthMm?: number;
}
export interface ImportResult {
  readonly objects: MapObject[];
  readonly outside: number; readonly duplicates: number; readonly short: number; readonly joined: number;
  /** Objekt som skars av vid kartans kant. */
  readonly clipped: number;
  /** Objekt vars form inte passar symbolen (en öppen linje som yta, en yta som punkt). */
  readonly mismatched: number;
}

const length = (points: readonly Point[]) => points.reduce((sum, point, index) => index === 0 ? 0 : sum + Math.hypot(point.x - points[index - 1]!.x,
  point.y - points[index - 1]!.y), 0);
const pathOf = (points: readonly Point[]): PathCommand[] => points.map((point, index) => ({ type: index === 0 ? "M" : "L", x: point.x, y: point.y }));
const JOIN_MM = 0.01;
const same = (a: readonly Point[], b: readonly Point[]) => a.length === b.length && a.every((point, at) => point.x === b[at]!.x && point.y === b[at]!.y);
const keyOf = (point: Point) => `${Math.round(point.x / JOIN_MM)},${Math.round(point.y / JOIN_MM)}`;

/** Öppna linjer med samma symbol som möts i ändarna slås ihop (baskartornas linjer i många bitar). Ger linjerna och antal hopslagningar. */
export function joinLines(lines: readonly Point[][]): { lines: Point[][]; joined: number } {
  const pending = lines.map(line => [...line]);
  const alive = pending.map(() => true);
  const byEnd = new Map<string, number[]>();
  const index = (line: Point[], at: number) => { for (const end of [line[0]!, line[line.length - 1]!]) byEnd.set(keyOf(end), [...(byEnd.get(keyOf(end)) ?? []), at]); };
  pending.forEach(index);
  let joined = 0;
  for (let at = 0; at < pending.length; at += 1) {
    if (!alive[at]) continue;
    let grown = true;
    while (grown) {
      grown = false;
      const line = pending[at]!;
      for (const atStart of [false, true]) {
        const end = atStart ? line[0]! : line[line.length - 1]!;
        const other = (byEnd.get(keyOf(end)) ?? []).find(candidate => candidate !== at && alive[candidate]);
        if (other === undefined) continue;
        const next = pending[other]!;
        const forward = keyOf(next[0]!) === keyOf(end);
        const oriented = forward ? next : [...next].reverse();
        pending[at] = atStart ? [...[...oriented].reverse(), ...line.slice(1)] : [...line, ...oriented.slice(1)];
        alive[other] = false;
        index(pending[at]!, at);
        joined += 1;
        grown = true;
        break;
      }
    }
  }
  return { lines: pending.filter((_, at) => alive[at]), joined };
}

type Box = { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
const within = (box: Box, point: Point) => point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;

/** En linje klippt mot rektangeln (Liang–Barsky per sträcka): bitarna inuti, i ordning. */
export function clipLine(points: readonly Point[], box: Box): Point[][] {
  const pieces: Point[][] = [];
  let current: Point[] = [];
  const close = () => { if (current.length >= 2) pieces.push(current); current = []; };
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!, b = points[index]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    let t0 = 0, t1 = 1, visible = true;
    for (const [p, q] of [[-dx, a.x - box.minX], [dx, box.maxX - a.x], [-dy, a.y - box.minY], [dy, box.maxY - a.y]] as const) {
      if (p === 0) { if (q < 0) { visible = false; break; } continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) { visible = false; break; } if (t > t0) t0 = t; }
      else { if (t < t0) { visible = false; break; } if (t < t1) t1 = t; }
    }
    if (!visible) { close(); continue; }
    const start = { x: a.x + t0 * dx, y: a.y + t0 * dy }, end = { x: a.x + t1 * dx, y: a.y + t1 * dy };
    if (t0 > 0 || current.length === 0) { close(); current.push(start); }
    current.push(end);
    if (t1 < 1) close();
  }
  close();
  return pieces;
}

/** En ring klippt mot rektangeln (Sutherland–Hodgman). */
export function clipRing(ring: readonly Point[], box: Box): Point[] {
  let output = [...ring];
  const edges: [(point: Point) => boolean, (a: Point, b: Point) => Point][] = [
    [point => point.x >= box.minX, (a, b) => ({ x: box.minX, y: a.y + (b.y - a.y) * (box.minX - a.x) / (b.x - a.x) })],
    [point => point.x <= box.maxX, (a, b) => ({ x: box.maxX, y: a.y + (b.y - a.y) * (box.maxX - a.x) / (b.x - a.x) })],
    [point => point.y >= box.minY, (a, b) => ({ x: a.x + (b.x - a.x) * (box.minY - a.y) / (b.y - a.y), y: box.minY })],
    [point => point.y <= box.maxY, (a, b) => ({ x: a.x + (b.x - a.x) * (box.maxY - a.y) / (b.y - a.y), y: box.maxY })]
  ];
  for (const [inside, cut] of edges) {
    const input = output;
    output = [];
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index]!, previous = input[(index + input.length - 1) % input.length]!;
      if (inside(current)) { if (!inside(previous)) output.push(cut(previous, current)); output.push(current); }
      else if (inside(previous)) output.push(cut(previous, current));
    }
    if (output.length === 0) break;
  }
  return output;
}

/** Lagrens objekt som kandidater i kartans mm, städade och klippta mot kartan. */
export function importObjects(features: readonly SourceFeature[], options: ImportOptions): ImportResult {
  const minLength = options.minLengthMm ?? 0.3;
  const bounds = options.bounds;
  const map = (points: readonly (readonly [number, number])[]) => points.map(([x, y]) => options.toMap(x, y));
  let outside = 0, mismatched = 0, short = 0, clipped = 0;
  const objects: MapObject[] = [];
  const openLines = new Map<string, Point[][]>();
  for (const { layer, geometry } of features) {
    const target = options.mapping.get(layer);
    if (!target) continue;
    const converted = convert(geometry, target.kind, map);
    if (!converted) { mismatched += 1; continue; }
    if (converted.kind === "point") {
      if (bounds && !within(bounds, converted.at)) { outside += 1; continue; }
      objects.push({ kind: "point", symbol: target.symbol, at: converted.at, angle: 0 });
    } else if (converted.kind === "area") {
      const rings = bounds ? converted.rings.map(ring => clipRing(ring, bounds)) : converted.rings;
      if ((rings[0]?.length ?? 0) < 3) { outside += 1; continue; }
      if (rings.some((ring, index) => !same(ring, converted.rings[index]!))) clipped += 1;
      objects.push({ kind: "area", symbol: target.symbol, rings: rings.filter(ring => ring.length >= 3).map(pathOf), angle: 0 });
    } else {
      const whole = converted.closed ? [...converted.points, converted.points[0]!] : converted.points;
      const pieces = bounds ? clipLine(whole, bounds) : [whole];
      if (pieces.length === 0) { outside += 1; continue; }
      const untouched = pieces.length === 1 && same(pieces[0]!, whole);
      if (!untouched) clipped += 1;
      if (converted.closed && untouched) objects.push({ kind: "line", symbol: target.symbol, path: pathOf(whole) });
      else for (const piece of pieces) openLines.set(target.symbol, [...(openLines.get(target.symbol) ?? []), piece]);
    }
  }
  let joined = 0;
  for (const [symbol, lines] of openLines) {
    const result = joinLines(lines);
    joined += result.joined;
    for (const line of result.lines) {
      if (length(line) < minLength) { short += 1; continue; }
      // En mycket lång hopslagen linje delas (högst `LIMITS.commands` punkter per objekt).
      for (let start = 0; start < line.length - 1; start += LIMITS.commands - 1) {
        objects.push({ kind: "line", symbol, path: pathOf(line.slice(start, start + LIMITS.commands)) });
      }
    }
  }
  // Dubbletter: samma symbol och samma punkter (på 0,01 mm).
  const seen = new Set<string>();
  const unique = objects.filter(object => {
    const points = object.kind === "point" || object.kind === "text" ? [object.at] : object.kind === "line" ? object.path : object.rings.flat();
    const key = `${object.symbol}|${points.map(keyOf).join(";")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { objects: unique, outside, clipped, duplicates: objects.length - unique.length, short, joined, mismatched };
}

type Converted = { kind: "point"; at: Point } | { kind: "line"; points: Point[]; closed: boolean } | { kind: "area"; rings: Point[][] };
function convert(geometry: SourceGeometry, kind: TargetKind, map: (points: readonly (readonly [number, number])[]) => Point[]): Converted | undefined {
  if (kind === "point") return geometry.kind === "point" ? { kind: "point", at: map([geometry.at])[0]! } : undefined;
  if (geometry.kind === "point") return undefined;
  if (kind === "line") {
    if (geometry.kind === "line") return { kind: "line", points: map(geometry.points), closed: geometry.closed };
    // En yta som linje: ytterkanten, sluten.
    return { kind: "line", points: map(geometry.rings[0] ?? []), closed: true };
  }
  if (geometry.kind === "area") return { kind: "area", rings: geometry.rings.map(ring => map(ring)) };
  return geometry.closed && geometry.points.length >= 3 ? { kind: "area", rings: [map(geometry.points)] } : undefined;
}
