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

/** SWEREF 99:s lokala zoner (12 00 … 23 15), alla med östligt 150 000 vid medelmeridianen. */
const SWEREF99_LOCAL_ZONES: readonly number[] = [3007, 3008, 3009, 3010, 3011, 3012, 3013, 3014, 3015, 3016, 3017, 3018];

/**
 * Koordinatsystemet ur koordinaternas storlek (östlig, nordlig): WGS 84, SWEREF 99 TM, RT 90, eller en lokal SWEREF 99-zon
 * (t.ex. Stockholms 18 00, EPSG:3011, som stadens baskarta använder). Den lokala zonen går inte att se på talen; med kartans
 * georeferens väljs zonen som lägger punkten närmast kartan (ägaren 2026-11-10: Högdalens DXF hamnade 520 km fel när
 * den lästes som SWEREF 99 TM). Undefined om det inte går att säga.
 */
export function guessCrs(data: SourceData, georeference?: MapGeoreference): number | undefined {
  // Medianen av de första punkterna (inte bara den första: en DXF har ofta ett objekt i origo, t.ex. en ram eller ett block).
  const xs: number[] = [], ys: number[] = [];
  for (const { geometry } of data.features) {
    const points = geometry.kind === "point" ? [geometry.at] : geometry.kind === "line" ? geometry.points : geometry.rings[0] ?? [];
    for (const [px, py] of points) if (px !== 0 || py !== 0) { xs.push(px); ys.push(py); }
    if (xs.length >= 500) break;
  }
  if (xs.length === 0) return undefined;
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  const x = median(xs), y = median(ys);
  if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return WGS84_EPSG;
  if (y > 6_100_000 && y < 7_700_000) {
    if (x > 1_100_000 && x < 2_000_000) return 3021;
    if (x > 250_000 && x < 950_000) return 3006;
    if (x > 0 && x < 300_000 && georeference && georeference.crs.kind === "EPSG") {
      const map = georeference;
      const scored = SWEREF99_LOCAL_ZONES.map(zone => {
        const point = sourcePointToMap(map, zone, x, y);
        return { zone, mm: Math.hypot(point.x - map.mapRefPoint.x, point.y - map.mapRefPoint.y) };
      }).sort((a, b) => a.mm - b.mm)[0];
      // Inom 30 km från kartans referenspunkt, annars är det inte den här kartans område.
      if (scored && scored.mm * map.scale / 1000 < 30_000) return scored.zone;
    }
  }
  return undefined;
}

/** Ord i lagrets namn (versaler, utan å, ä och ö) → symbolens nummer, som i plandokumentet för baskartorna. Första träffen gäller. */
const KEYWORDS: readonly { readonly words: RegExp; readonly line?: string; readonly area?: string; readonly point?: string }[] = [
  // Geo-arbetarens vegetation (K5c del 3): öppen mark, tre gröna och undervegetation.
  { words: /OPPEN_MARK|OPEN_LAND/, area: "401" },
  { words: /UNDERVEGETATION_SVARLOPT/, area: "409" },
  { words: /UNDERVEGETATION/, area: "407" },
  { words: /GRON_MYCKET_SVARLOPT/, area: "410" },
  { words: /GRON_SVARLOPT/, area: "408" },
  { words: /GRON_LATTLOPT/, area: "406" },
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
  // Geo-arbetarens fuktighet (K5c): fuktstråk, blött och fuktigt.
  { words: /FUKTSTRAK/, line: "306" },
  { words: /BLOTT|SANKMARK|MYR|MARSH/, area: "308" },
  { words: /FUKTIG/, area: "310" },
  { words: /DIKE|DITCH|BACK|STREAM/, line: "305" },
  { words: /VATTEN|SJO|LAKE|WATER/, area: "301" },
  // Karttapullautins lager (K5), före de vanliga kurvorna. «_intermed» är varje kurva på halva ekvidistansen, inte
  // stödkurvorna (de ligger i formline): lagret hoppas över, annars blir hela kartan streckad.
  { words: /CONTOUR_INTERMED|DEPRESSION_INTERMED/ },
  { words: /CONTOUR_INDEX|INDEXKURVA/, line: "102" },
  { words: /FORMLINE|STODKURVA/, line: "103" },
  { words: /SLOPE_LINE/, line: "104" },
  { words: /CLIFF3|CLIFF4/, line: "201" },
  { words: /CLIFF2|CLIFF/, line: "202" },
  { words: /DOTKNOLL/, point: "109" },
  { words: /UDEPRESSION|PUNKTGROP/, point: "111" },
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
  /** Trappsymbolerna (id): korta parallella steglinjer i en trappsymbol blir en trapplinja längs trappan. */
  readonly stairSymbols?: ReadonlySet<string> | undefined;
}
export interface ImportResult {
  readonly objects: MapObject[];
  readonly outside: number; readonly duplicates: number; readonly short: number; readonly joined: number;
  /** Objekt som skars av vid kartans kant. */
  readonly clipped: number;
  /** Objekt vars form inte passar symbolen (en öppen linje som yta, en yta som punkt). */
  readonly mismatched: number;
  /** Ytor som byggts av öppna linjer som sluter sig när de slagits ihop (t.ex. fasadlinjer till en byggnad). */
  readonly closedAreas: number;
  /** Trappor som byggts av steglinjer, och hur många steglinjer de ersatte. */
  readonly stairs: number; readonly steps: number;
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
  const openAreas = new Map<string, Point[][]>();
  for (const { layer, geometry } of features) {
    const target = options.mapping.get(layer);
    if (!target) continue;
    const converted = convert(geometry, target.kind, map);
    if (!converted) { mismatched += 1; continue; }
    if (target.kind === "area" && converted.kind === "line") { openAreas.set(target.symbol, [...(openAreas.get(target.symbol) ?? []), converted.points]); continue; }
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
  let joined = 0, closedAreas = 0, stairs = 0, steps = 0;
  const pushArea = (symbol: string, ring: Point[]) => {
    const kept = bounds ? clipRing(ring, bounds) : ring;
    if (kept.length < 3) { outside += 1; return false; }
    if (!same(kept, ring)) clipped += 1;
    objects.push({ kind: "area", symbol, rings: [pathOf(kept)], angle: 0 });
    return true;
  };
  for (const [symbol, lines] of openAreas) {
    const result = joinLines(lines);
    joined += result.joined;
    for (const line of result.lines) {
      const first = line[0]!, last = line[line.length - 1]!;
      if (line.length >= 4 && Math.hypot(first.x - last.x, first.y - last.y) <= CLOSE_MM) {
        if (pushArea(symbol, line.slice(0, -1))) closedAreas += 1;
      } else mismatched += 1;
    }
  }
  for (const [symbol, all] of openLines) {
    let lines = all;
    if (options.stairSymbols?.has(symbol)) {
      const found = stairsFromSteps(all);
      lines = found.rest;
      stairs += found.stairs.length; steps += found.steps;
      for (const stair of found.stairs) objects.push({ kind: "line", symbol, path: pathOf(stair) });
    }
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
    const key = object.kind === "point" || object.kind === "text" ? `${object.symbol}|${keyOf(object.at)}`
      : object.kind === "line" ? `${object.symbol}|${object.path.map(keyOf).join(";")}`
      : `${object.symbol}|${object.rings.map(ringKey).join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { objects: unique, outside, clipped, duplicates: objects.length - unique.length, short, joined, mismatched, closedAreas, stairs, steps };
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
  if (geometry.closed && geometry.points.length >= 3) return { kind: "area", rings: [map(geometry.points)] };
  // En öppen linje till en yta: sparas och slås ihop med andra; sluter de sig blir de en yta.
  return geometry.points.length >= 2 ? { kind: "line", points: map(geometry.points), closed: false } : undefined;
}

const CLOSE_MM = 0.05;
const STEP_MAX_MM = 3;
const STEP_GAP_MM = 1;
const STEP_ANGLE = 15 * Math.PI / 180;
const MIN_STEPS = 3;

/** En nästan rak linje (alla punkter inom 0,05 mm från kordan). */
function straight(points: readonly Point[]): boolean {
  const a = points[0]!, b = points[points.length - 1]!;
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (chord === 0) return false;
  return points.every(point => Math.abs((b.x - a.x) * (a.y - point.y) - (a.x - point.x) * (b.y - a.y)) / chord <= 0.05);
}

/**
 * Trappor ur steglinjer: korta raka linjer som ligger parallellt och tätt (högst 1 mm mellan mitterna, högst 15° vinkelskillnad)
 * blir en linje genom stegens mittpunkter, i trappans riktning. Grupper med färre än tre steg lämnas som de är.
 */
export function stairsFromSteps(lines: readonly Point[][]): { stairs: Point[][]; rest: Point[][]; steps: number } {
  const steps: { line: Point[]; mid: Point; angle: number; length: number }[] = [];
  const rest: Point[][] = [];
  for (const line of lines) {
    const a = line[0]!, b = line[line.length - 1]!;
    const lengthMm = Math.hypot(b.x - a.x, b.y - a.y);
    if (lengthMm > 0 && lengthMm <= STEP_MAX_MM && straight(line)) {
      // Riktningen modulo 180°.
      let angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (angle < 0) angle += Math.PI;
      if (angle >= Math.PI) angle -= Math.PI;
      steps.push({ line, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle, length: lengthMm });
    } else rest.push(line);
  }
  const parent = steps.map((_, index) => index);
  const find = (index: number): number => { while (parent[index] !== index) { parent[index] = parent[parent[index]!]!; index = parent[index]!; } return index; };
  for (let i = 0; i < steps.length; i += 1) for (let j = i + 1; j < steps.length; j += 1) {
    const s = steps[i]!, t = steps[j]!;
    let turn = Math.abs(s.angle - t.angle);
    turn = Math.min(turn, Math.PI - turn);
    if (turn > STEP_ANGLE) continue;
    const dx = t.mid.x - s.mid.x, dy = t.mid.y - s.mid.y;
    if (Math.hypot(dx, dy) > STEP_GAP_MM) continue;
    // Stegen ska ligga bredvid varandra, inte i förlängningen av varandra.
    const along = Math.abs(dx * Math.cos(s.angle) + dy * Math.sin(s.angle));
    if (along > Math.min(s.length, t.length) / 2) continue;
    parent[find(j)] = find(i);
  }
  const groups = new Map<number, number[]>();
  steps.forEach((_, index) => groups.set(find(index), [...(groups.get(find(index)) ?? []), index]));
  const stairs: Point[][] = [];
  let used = 0;
  for (const members of groups.values()) {
    if (members.length < MIN_STEPS) { for (const index of members) rest.push(steps[index]!.line); continue; }
    const angle = members.reduce((sum, index) => sum + steps[index]!.angle, 0) / members.length;
    const normal = { x: -Math.sin(angle), y: Math.cos(angle) };
    const mids = members.map(index => steps[index]!.mid).sort((p, q) => (p.x * normal.x + p.y * normal.y) - (q.x * normal.x + q.y * normal.y));
    stairs.push(mids);
    used += members.length;
  }
  return { stairs, rest, steps: used };
}

/** Ringens nyckel oberoende av startpunkt och riktning, så att samma yta från två lager känns igen. */
function ringKey(ring: readonly Point[]): string {
  const keys = ring.map(keyOf);
  if (keys.length > 1 && keys[0] === keys[keys.length - 1]) keys.pop();
  if (keys.length === 0) return "";
  // Börja i den minsta punkten och välj det håll som ger den minsta nyckeln (linjärt, även för långa ringar).
  let start = 0;
  keys.forEach((key, at) => { if (key < keys[start]!) start = at; });
  const forward = [...keys.slice(start), ...keys.slice(0, start)];
  const backward = [forward[0]!, ...forward.slice(1).reverse()];
  const a = forward.join(";"), b = backward.join(";");
  return a < b ? a : b;
}
