/**
 * Nivåstödet (ADR-0212): kartans ledstänger, föremål, öppna ytor och höjdkurvor i rutnät för snabba frågor, en gång per
 * `ParsedMap` (sparas i en WeakMap). Bara kartans egna symboler, som löparna ser (dolda symboler räknas inte). Kartans mm,
 * y uppåt.
 */
import { flattenPath, type MapObject, type MapSymbol, type ParsedMap, type Point } from "@o-tid/map-file";
import type { FeatureSize, HandrailKind } from "./level-types";
import { DISTINCT_HILL_METERS, HANDRAIL_BY_DESCRIPTION, HANDRAIL_BY_SYMBOL, OPEN_LAND_SYMBOLS, SIZE_BY_DESCRIPTION, SIZE_BY_SYMBOL } from "./level-symbols";
import { featureRuleFor } from "./suggest-symbols";
import { insideRings } from "./suggest-geometry";

const CELL_MM = 4;
const key = (cx: number, cy: number) => cx * 1_000_003 + cy;
/** Slutna höjdkurvor större än så här (mm) är inte en höjd vid kontrollen. */
const MAX_LOOP_MM = 6;
/** En ytas kant räknas som ledstång först när ytan är minst så här stor (mm på kartan). */
const MIN_EDGE_AREA_MM = 0.8;

export interface LevelSegment { readonly a: Point; readonly b: Point; readonly feature: number; readonly kind: HandrailKind; readonly main: number }
/** Ett föremål med storlek (punkt, liten yta eller sluten höjdkurva). */
export interface LevelObject {
  readonly at: Point;
  /** Ytans eller slingans ring (avståndet mäts till den; inuti = 0). */
  readonly ring?: readonly Point[] | undefined;
  readonly size: FeatureSize;
  readonly d?: string | undefined;
  readonly code: string;
  readonly name: string;
}

export interface LevelMap {
  readonly scale: number;
  readonly segments: readonly LevelSegment[];
  readonly segmentGrid: ReadonlyMap<number, readonly number[]>;
  readonly objects: readonly LevelObject[];
  readonly objectGrid: ReadonlyMap<number, readonly number[]>;
  /** Höjdkurvornas delar med vikt (1 = hel ekvidistans, 0,5 = hjälpkurva). */
  readonly contours: readonly { readonly a: Point; readonly b: Point; readonly weight: number }[];
  readonly contourGrid: ReadonlyMap<number, readonly number[]>;
  readonly open: readonly { readonly rings: readonly (readonly Point[])[]; readonly box: Box }[];
  /** Ändarna på väg- och stiglinjerna (502–508), för korsningarna i stignätet. */
  readonly pathEnds: readonly { readonly at: Point; readonly feature: number }[];
  /** Linjedetaljer i terrängen (branter, jordvallar, rasbranter, erosionsrännor): punkter längs linjen med linjens nummer. */
  readonly detailPoints: readonly { readonly at: Point; readonly feature: number }[];
  readonly detailGrid: ReadonlyMap<number, readonly number[]>;
}

/** ISOM 2017-2: linjer som är detaljer i terrängen (jordvall, erosionsränna, branter); de gör ett kontrolläge detaljrikt. */
const DETAIL_LINE_SYMBOLS: readonly number[] = [104, 105, 106, 107, 201, 202, 203];

interface Box { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

const cache = new WeakMap<ParsedMap, Map<string, LevelMap>>();

function boxOf(lines: readonly (readonly Point[])[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const line of lines) for (const p of line) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function insertBox(grid: Map<number, number[]>, box: Box, index: number): void {
  for (let cx = Math.floor(box.minX / CELL_MM); cx <= Math.floor(box.maxX / CELL_MM); cx++) {
    for (let cy = Math.floor(box.minY / CELL_MM); cy <= Math.floor(box.maxY / CELL_MM); cy++) {
      const list = grid.get(key(cx, cy));
      if (list) list.push(index); else grid.set(key(cx, cy), [index]);
    }
  }
}

const geometryOf = (object: MapObject) => object.kind === "text" ? undefined : object.kind;
const linesOf = (object: MapObject): Point[][] => object.kind === "line" ? flattenPath(object.path).filter(line => line.length > 0)
  : object.kind === "area" ? object.rings.flatMap(ring => flattenPath(ring)).filter(line => line.length > 0) : [];

function centroid(points: readonly Point[]): Point {
  let x = 0, y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / Math.max(1, points.length), y: y / Math.max(1, points.length) };
}

/** Kartans delar för nivåstödet; byggs första gången och sparas per karta (och sprint eller skog). */
export function prepareLevelMap(map: ParsedMap, sprint = false): LevelMap {
  const signature = sprint ? "sprint" : "isom";
  const known = cache.get(map)?.get(signature);
  if (known) return known;
  const scale = map.scale > 0 ? map.scale : 15000;
  const segments: LevelSegment[] = [], objects: LevelObject[] = [], contours: LevelMap["contours"][number][] = [], open: LevelMap["open"][number][] = [];
  const pathEnds: { at: Point; feature: number }[] = [];
  const detailPoints: { at: Point; feature: number }[] = [];
  const detailGrid = new Map<number, number[]>();
  const segmentGrid = new Map<number, number[]>(), objectGrid = new Map<number, number[]>(), contourGrid = new Map<number, number[]>();
  const addSegments = (lines: readonly (readonly Point[])[], feature: number, kind: HandrailKind, main: number) => {
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!, b = line[i]!;
      if (a.x === b.x && a.y === b.y) continue;
      insertBox(segmentGrid, boxOf([[a, b]]), segments.length);
      segments.push({ a, b, feature, kind, main });
    }
  };
  const addObject = (object: LevelObject) => {
    const box = object.ring ? boxOf([object.ring]) : { minX: object.at.x, minY: object.at.y, maxX: object.at.x, maxY: object.at.y };
    insertBox(objectGrid, box, objects.length);
    objects.push(object);
  };
  map.objects.forEach((object, index) => {
    const geometry = geometryOf(object);
    const symbol: MapSymbol | undefined = map.symbols.get(object.symbol);
    if (!geometry || !symbol || symbol.hidden) return;
    const main = symbol.code.main;
    if (main >= 101 && main <= 103) {
      if (object.kind !== "line") return;
      const weight = main === 103 ? 0.5 : 1;
      for (const line of flattenPath(object.path)) {
        for (let i = 1; i < line.length; i++) {
          insertBox(contourGrid, boxOf([[line[i - 1]!, line[i]!]]), contours.length);
          contours.push({ a: line[i - 1]!, b: line[i]!, weight });
        }
        // En liten sluten kurva är en höjd (eller en grop): tydlig om den är stor nog, annars liten.
        const closed = line.length > 3 && Math.hypot(line[0]!.x - line[line.length - 1]!.x, line[0]!.y - line[line.length - 1]!.y) < 0.4;
        const box = boxOf([line]);
        const span = Math.max(box.maxX - box.minX, box.maxY - box.minY);
        if (closed && span <= MAX_LOOP_MM) {
          const big = main !== 103 && span * scale / 1000 >= DISTINCT_HILL_METERS;
          addObject({ at: centroid(line), ring: line, size: big ? "BIG" : main === 103 ? "SMALL" : "MEDIUM", d: big ? "1.9" : "1.10", code: symbol.code.text, name: symbol.name });
        }
      }
      return;
    }
    if (!sprint && DETAIL_LINE_SYMBOLS.includes(main) && object.kind === "line") {
      for (const line of flattenPath(object.path)) for (const at of line) {
        insertBox(detailGrid, { minX: at.x, minY: at.y, maxX: at.x, maxY: at.y }, detailPoints.length);
        detailPoints.push({ at, feature: index });
      }
    }
    const lookup = featureRuleFor(symbol.code, symbol.name, geometry, sprint);
    const d = lookup?.rule.d;
    const lines = linesOf(object);
    const handrail = lookup?.by === "NAME" ? (d ? HANDRAIL_BY_DESCRIPTION[d] : undefined) : HANDRAIL_BY_SYMBOL[main];
    if (OPEN_LAND_SYMBOLS.includes(main) && object.kind === "area" && lookup?.by !== "NAME") open.push({ rings: lines, box: boxOf(lines) });
    if (handrail && object.kind !== "point") {
      const box = boxOf(lines);
      const large = object.kind === "line" || Math.max(box.maxX - box.minX, box.maxY - box.minY) >= MIN_EDGE_AREA_MM;
      if (large) addSegments(lines, index, handrail, main);
      if (main >= 502 && main <= 508 && object.kind === "line") for (const line of lines) if (line.length > 1) pathEnds.push({ at: line[0]!, feature: index }, { at: line[line.length - 1]!, feature: index });
    }
    const size = (lookup?.by === "NUMBER" ? SIZE_BY_SYMBOL[main] : undefined) ?? (d ? SIZE_BY_DESCRIPTION[d] : undefined);
    if (!size || size === "LINE") return;
    if (object.kind === "point") addObject({ at: object.at, size, d, code: symbol.code.text, name: symbol.name });
    else if (object.kind === "area") {
      const box = boxOf(lines);
      // Bara avgränsade ytor (en byggnad, en göl, en sankmark) är föremål; ett stort område är det inte.
      if (Math.max(box.maxX - box.minX, box.maxY - box.minY) <= MAX_LOOP_MM && lines[0]) addObject({ at: centroid(lines[0]), ring: lines[0], size, d, code: symbol.code.text, name: symbol.name });
    }
  });
  const prepared: LevelMap = { scale, segments, segmentGrid, objects, objectGrid, contours, contourGrid, open, pathEnds, detailPoints, detailGrid };
  if (!cache.has(map)) cache.set(map, new Map());
  cache.get(map)!.set(signature, prepared);
  return prepared;
}

function near(grid: ReadonlyMap<number, readonly number[]>, at: Point, radius: number, visit: (index: number) => void): void {
  const seen = new Set<number>();
  for (let cx = Math.floor((at.x - radius) / CELL_MM); cx <= Math.floor((at.x + radius) / CELL_MM); cx++) {
    for (let cy = Math.floor((at.y - radius) / CELL_MM); cy <= Math.floor((at.y + radius) / CELL_MM); cy++) {
      for (const index of grid.get(key(cx, cy)) ?? []) if (!seen.has(index)) { seen.add(index); visit(index); }
    }
  }
}

export function nearestOnSegment(p: Point, a: Point, b: Point): { point: Point; distance: number } {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, distance: Math.hypot(p.x - point.x, p.y - point.y) };
}

/** Närmaste ledstång inom `radius` mm (bara tydliga med `strongOnly`). */
export function nearestHandrail(prepared: LevelMap, at: Point, radius: number, strongOnly: boolean):
  { distance: number; point: Point; segment: LevelSegment } | undefined {
  let best: { distance: number; point: Point; segment: LevelSegment } | undefined;
  near(prepared.segmentGrid, at, radius, index => {
    const segment = prepared.segments[index]!;
    if (strongOnly && segment.kind !== "STRONG") return;
    const hit = nearestOnSegment(at, segment.a, segment.b);
    if (hit.distance <= radius && (!best || hit.distance < best.distance)) best = { ...hit, segment };
  });
  return best;
}

export function inOpenLand(prepared: LevelMap, at: Point): boolean {
  return prepared.open.some(area => at.x >= area.box.minX && at.x <= area.box.maxX && at.y >= area.box.minY && at.y <= area.box.maxY &&
    insideRings(at, area.rings));
}

/** Avståndet (mm) från punkten till föremålet: till ringen, 0 inuti. */
export function objectDistance(object: LevelObject, at: Point): number {
  if (!object.ring) return Math.hypot(at.x - object.at.x, at.y - object.at.y);
  if (insideRings(at, [object.ring])) return 0;
  let best = Infinity;
  for (let i = 1; i < object.ring.length; i++) best = Math.min(best, nearestOnSegment(at, object.ring[i - 1]!, object.ring[i]!).distance);
  return best;
}

/** Föremålen inom `radius` mm, närmast först. */
export function objectsNear(prepared: LevelMap, at: Point, radius: number): { object: LevelObject; distance: number }[] {
  const out: { object: LevelObject; distance: number }[] = [];
  near(prepared.objectGrid, at, radius, index => {
    const object = prepared.objects[index]!;
    const distance = objectDistance(object, at);
    if (distance <= radius) out.push({ object, distance });
  });
  return out.sort((a, b) => a.distance - b.distance);
}

/** Antalet linjedetaljer (branter, jordvallar …) som har någon del inom `radius` mm. */
export function detailLinesNear(prepared: LevelMap, at: Point, radius: number): number {
  const features = new Set<number>();
  near(prepared.detailGrid, at, radius, index => {
    const point = prepared.detailPoints[index]!;
    if (Math.hypot(point.at.x - at.x, point.at.y - at.y) <= radius) features.add(point.feature);
  });
  return features.size;
}

/** Höjdkurvornas längd (mm, viktad) inom `radius` mm från punkten (delarna räknas med den del som ligger i cirkeln, ungefär). */
export function contourLengthNear(prepared: LevelMap, at: Point, radius: number): number {
  let total = 0;
  near(prepared.contourGrid, at, radius, index => {
    const { a, b, weight } = prepared.contours[index]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(length / (radius / 4)));
    let inside = 0;
    for (let step = 0; step < steps; step++) {
      const t = (step + 0.5) / steps;
      if (Math.hypot(a.x + (b.x - a.x) * t - at.x, a.y + (b.y - a.y) * t - at.y) <= radius) inside += 1;
    }
    total += weight * length * inside / steps;
  });
  return total;
}

const networkCache = new WeakMap<LevelMap, { points: Point[]; grid: Map<number, number[]> }>();

/**
 * Alla korsningar och förgreningar i väg- och stignätet (502–508), en gång per karta; punkter närmare än 3 m är samma
 * korsning (flera linjedelar som möts i samma punkt).
 */
function networkJunctions(prepared: LevelMap) {
  const known = networkCache.get(prepared);
  if (known) return known;
  const points: Point[] = [];
  const grid = new Map<number, number[]>();
  const same = 3 * 1000 / prepared.scale;
  const add = (p: Point) => {
    let duplicate = false;
    near(grid, p, same, index => { if (Math.hypot(points[index]!.x - p.x, points[index]!.y - p.y) <= same) duplicate = true; });
    if (duplicate) return;
    insertBox(grid, { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }, points.length);
    points.push(p);
  };
  const isPath = (segment: LevelSegment) => segment.main >= 502 && segment.main <= 508;
  const inside = (t: number) => t > 0.01 && t < 0.99;
  // Korsningar (X): två linjer som skär varandra inne på båda delarna.
  prepared.segments.forEach((p, i) => {
    if (!isPath(p)) return;
    const box = boxOf([[p.a, p.b]]);
    near(prepared.segmentGrid, { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
      Math.max(box.maxX - box.minX, box.maxY - box.minY) / 2 + 0.2, j => {
        const q = prepared.segments[j]!;
        if (j <= i || !isPath(q) || q.feature === p.feature) return;
        const hit = crossing(p, q);
        if (hit && inside(hit.t) && inside(hit.u)) add(hit.at);
      });
  });
  // Förgreningar (T): en linje slutar på en annan. Två linjer som bara möts ände mot ände är en och samma stig; tre eller
  // fler ändar i samma punkt (Y) är en förgrening.
  const endGrid = new Map<number, number[]>();
  prepared.pathEnds.forEach((end, index) => insertBox(endGrid, { minX: end.at.x, minY: end.at.y, maxX: end.at.x, maxY: end.at.y }, index));
  for (const end of prepared.pathEnds) {
    const features = new Set<number>([end.feature]);
    near(prepared.segmentGrid, end.at, 0.2, j => {
      const q = prepared.segments[j]!;
      if (!isPath(q) || q.feature === end.feature) return;
      const hit = nearestOnSegment(end.at, q.a, q.b);
      if (hit.distance > 0.2) return;
      const length = Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y);
      const t = length === 0 ? 0 : Math.hypot(hit.point.x - q.a.x, hit.point.y - q.a.y) / length;
      if (inside(t)) features.add(q.feature);
    });
    if (features.size >= 2) { add(end.at); continue; }
    near(endGrid, end.at, 0.2, index => {
      const other = prepared.pathEnds[index]!;
      if (Math.hypot(other.at.x - end.at.x, other.at.y - end.at.y) <= 0.2) features.add(other.feature);
    });
    if (features.size >= 3) add(end.at);
  }
  const out = { points, grid };
  networkCache.set(prepared, out);
  return out;
}

/** Korsningarna i stignätet inom `radius` mm (index, samma för samma korsning). */
export function networkJunctionsNear(prepared: LevelMap, at: Point, radius: number): number[] {
  const { points, grid } = networkJunctions(prepared);
  const out: number[] = [];
  near(grid, at, radius, index => { if (Math.hypot(points[index]!.x - at.x, points[index]!.y - at.y) <= radius) out.push(index); });
  return out;
}

/** Stigkorsningar (två tydliga ledstänger av väg- och stigslag som möts) inom `radius` mm, närmast först. */
export function junctionsNear(prepared: LevelMap, at: Point, radius: number): Point[] {
  const list: LevelSegment[] = [];
  near(prepared.segmentGrid, at, radius, index => {
    const segment = prepared.segments[index]!;
    if (segment.main >= 502 && segment.main <= 508 && nearestOnSegment(at, segment.a, segment.b).distance <= radius) list.push(segment);
  });
  const out: Point[] = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const p = list[i]!, q = list[j]!;
    if (p.feature === q.feature) continue;
    const hit = intersection(p, q) ?? touching(p, q);
    if (hit && Math.hypot(hit.x - at.x, hit.y - at.y) <= radius) out.push(hit);
  }
  return out.sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y));
}

function crossing(p: LevelSegment, q: LevelSegment): { at: Point; t: number; u: number } | undefined {
  const rx = p.b.x - p.a.x, ry = p.b.y - p.a.y, sx = q.b.x - q.a.x, sy = q.b.y - q.a.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return undefined;
  const t = ((q.a.x - p.a.x) * sy - (q.a.y - p.a.y) * sx) / den, u = ((q.a.x - p.a.x) * ry - (q.a.y - p.a.y) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { at: { x: p.a.x + t * rx, y: p.a.y + t * ry }, t, u } : undefined;
}

function intersection(p: LevelSegment, q: LevelSegment): Point | undefined {
  const rx = p.b.x - p.a.x, ry = p.b.y - p.a.y, sx = q.b.x - q.a.x, sy = q.b.y - q.a.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return undefined;
  const t = ((q.a.x - p.a.x) * sy - (q.a.y - p.a.y) * sx) / den, u = ((q.a.x - p.a.x) * ry - (q.a.y - p.a.y) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: p.a.x + t * rx, y: p.a.y + t * ry } : undefined;
}

/** En T-korsning: en ände ligger högst 0,2 mm från den andra linjen. */
function touching(p: LevelSegment, q: LevelSegment): Point | undefined {
  for (const [end, other] of [[p.a, q], [p.b, q], [q.a, p], [q.b, p]] as const) {
    const hit = nearestOnSegment(end, other.a, other.b);
    if (hit.distance <= 0.2) return end;
  }
  return undefined;
}
