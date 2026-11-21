import { flattenPath, type MapObject, type MapSymbol, type Point } from "@o-tid/map-file";
import { objectParts, vertices, type ObjectKey } from "@o-tid/map-revision";

/**
 * K8b V3 (ägaren 2026-11-21): Fäst. Punkten man sätter eller drar fästs mot kartans synliga objekt nära pekaren, i den här
 * ordningen: 1) en ändpunkt eller brytpunkt (också kurvornas ankarpunkter och punktobjekt), 2) en skärning mellan två linjer
 * eller ytkanter, 3) närmaste punkt på en linje eller ytkant. Ren geometri utan React; kartans mm med y uppåt.
 *
 * Indexet byggs i kartans Worker när objekten ändras (`buildSnapIndex`) och skickas till sidan som typade fält, så att
 * frågan (`snapAt`) går direkt i pekarens händelse och bara läser rutorna kring pekaren.
 */
export type SnapKind = "vertex" | "intersection" | "edge";

/** Objektet och delen som fästpunkten ligger på (för V5:s följ kant). `key` saknas för det egna utkastet (`extra`). */
export interface SnapTarget {
  readonly key: ObjectKey | undefined;
  readonly symbol: string | undefined;
  /** Delen (linjens del per M eller ytans ring) som i `objectParts`. */
  readonly part: number;
  /** Brytpunktens ordningstal (vertex) eller sträckans i delens utplattade linje (edge, intersection). */
  readonly index: number;
  /** Sträckan (edge, intersection) och var på den (0–1). */
  readonly from?: Point | undefined;
  readonly to?: Point | undefined;
  readonly t?: number | undefined;
}

export interface SnapHit {
  readonly kind: SnapKind;
  readonly at: Point;
  /** Avståndet från pekaren (mm). */
  readonly distance: number;
  readonly target: SnapTarget;
  /** Den andra linjen i en skärning. */
  readonly other?: SnapTarget | undefined;
}

/** Fästindexet: sträckor och punkter i ett rutnät (CSR: `cells[i]..cells[i+1]` i `items`). */
export interface SnapIndex {
  readonly keys: readonly ObjectKey[];
  readonly symbols: readonly string[];
  /** x1, y1, x2, y2 per sträcka. */
  readonly segments: Float64Array;
  /** Objekt, del och sträcka per sträcka. */
  readonly segmentInfo: Int32Array;
  /** x, y per punkt. */
  readonly points: Float64Array;
  /** Objekt, del och ordningstal per punkt. */
  readonly pointInfo: Int32Array;
  readonly grid: { readonly minX: number; readonly minY: number; readonly cell: number; readonly cols: number; readonly rows: number };
  readonly segmentCells: Int32Array;
  readonly segmentItems: Int32Array;
  readonly pointCells: Int32Array;
  readonly pointItems: Int32Array;
}

/** Det egna utkastet eller objektet som dras: punkter och sträckor som inte finns i indexet. */
export interface SnapExtra { readonly points: readonly Point[]; readonly segments: readonly (readonly [Point, Point])[] }

export interface SnapQuery {
  readonly point: Point;
  readonly reachMm: number;
  /** Släckta symboler. */
  readonly hidden?: ReadonlySet<string> | undefined;
  /** Objekten som inte fäster (det som ritas eller dras). */
  readonly exclude?: ReadonlySet<ObjectKey> | undefined;
  readonly extra?: SnapExtra | undefined;
}

/** Fästets räckvidd på skärmen: ~10 px med mus, ~22 px med finger eller penna. */
export const SNAP_MOUSE_PX = 10;
export const SNAP_TOUCH_PX = 22;
export const snapReachMm = (pointerType: string, pxPerMm: number): number =>
  (pointerType === "touch" || pointerType === "pen" ? SNAP_TOUCH_PX : SNAP_MOUSE_PX) / Math.max(pxPerMm, 1e-9);

/** Flest sträckor nära pekaren som prövas mot varandra för skärningar (de närmaste). */
const MAX_CROSSING = 48;
const MAX_CELLS = 1 << 22;

class Growing {
  private data: number[] = [];
  push(...values: number[]) { for (const value of values) this.data.push(value); }
  get length() { return this.data.length; }
  floats() { return Float64Array.from(this.data); }
  ints() { return Int32Array.from(this.data); }
}

/**
 * Indexet över kartans synliga objekt: linjer, ytornas ringar och punktobjekt (inte texter och inte symboler som är dolda i
 * filen; släckta lager filtreras i frågan). `keys` i samma ordning som `objects`.
 */
export function buildSnapIndex(objects: readonly MapObject[], keys: readonly ObjectKey[], symbols: ReadonlyMap<string, MapSymbol>): SnapIndex {
  const keyList: ObjectKey[] = [], symbolList: string[] = [];
  const segments = new Growing(), segmentInfo = new Growing(), points = new Growing(), pointInfo = new Growing();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const extend = (x: number, y: number) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
  objects.forEach((object, objectIndex) => {
    const key = keys[objectIndex];
    if (key === undefined || object.kind === "text" || symbols.get(object.symbol)?.hidden) return;
    const id = keyList.length;
    keyList.push(key); symbolList.push(object.symbol);
    if (object.kind === "point") { points.push(object.at.x, object.at.y); pointInfo.push(id, 0, 0); extend(object.at.x, object.at.y); return; }
    for (const vertex of vertices(object)) { points.push(vertex.at.x, vertex.at.y); pointInfo.push(id, vertex.part, vertex.index); extend(vertex.at.x, vertex.at.y); }
    objectParts(object).forEach((part, partIndex) => {
      let index = 0;
      for (const flat of flattenPath(part)) {
        // K8b V5: en ytas ring sluts också när filen inte upprepar första punkten (kanten finns att fästa och följa).
        const first = flat[0], last = flat[flat.length - 1];
        const line = object.kind === "area" && first && last && flat.length > 2 && (first.x !== last.x || first.y !== last.y) ? [...flat, first] : flat;
        for (let i = 1; i < line.length; i += 1) {
          const a = line[i - 1]!, b = line[i]!;
          segments.push(a.x, a.y, b.x, b.y); segmentInfo.push(id, partIndex, index++);
          extend(a.x, a.y); extend(b.x, b.y);
        }
      }
    });
  });
  const segmentArray = segments.floats(), pointArray = points.floats();
  const count = segmentArray.length / 4 + pointArray.length / 2;
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
  const width = Math.max(maxX - minX, 1e-6), height = Math.max(maxY - minY, 1e-6);
  // Rutor ungefär så stora att det blir ett par sträckor i varje; aldrig fler än MAX_CELLS.
  let cell = Math.max(0.25, Math.sqrt(width * height / Math.max(count, 1)) * 1.5);
  while (Math.ceil(width / cell) * Math.ceil(height / cell) > MAX_CELLS) cell *= 2;
  const cols = Math.max(1, Math.ceil(width / cell)), rows = Math.max(1, Math.ceil(height / cell));
  const grid = { minX, minY, cell, cols, rows };
  const column = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor((x - minX) / cell)));
  const row = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor((y - minY) / cell)));
  const bucket = (items: number, ranges: (item: number, visit: (cellIndex: number) => void) => void) => {
    const cells = new Int32Array(cols * rows + 1);
    for (let item = 0; item < items; item += 1) ranges(item, cellIndex => { cells[cellIndex + 1]! += 1; });
    for (let i = 1; i < cells.length; i += 1) cells[i]! += cells[i - 1]!;
    const fill = cells.slice(0, -1), out = new Int32Array(cells[cells.length - 1]!);
    for (let item = 0; item < items; item += 1) ranges(item, cellIndex => { out[fill[cellIndex]!++] = item; });
    return { cells, items: out };
  };
  const segmentBuckets = bucket(segmentArray.length / 4, (item, visit) => {
    const o = item * 4, x1 = segmentArray[o]!, y1 = segmentArray[o + 1]!, x2 = segmentArray[o + 2]!, y2 = segmentArray[o + 3]!;
    const c0 = column(Math.min(x1, x2)), c1 = column(Math.max(x1, x2)), r0 = row(Math.min(y1, y2)), r1 = row(Math.max(y1, y2));
    for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) visit(r * cols + c);
  });
  const pointBuckets = bucket(pointArray.length / 2, (item, visit) => visit(row(pointArray[item * 2 + 1]!) * cols + column(pointArray[item * 2]!)));
  return { keys: keyList, symbols: symbolList, segments: segmentArray, segmentInfo: segmentInfo.ints(), points: pointArray, pointInfo: pointInfo.ints(), grid,
    segmentCells: segmentBuckets.cells, segmentItems: segmentBuckets.items, pointCells: pointBuckets.cells, pointItems: pointBuckets.items };
}

/** Indexets typade fält (att skicka från Workern utan kopia). */
export const snapTransfer = (index: SnapIndex): Transferable[] => [index.segments.buffer, index.segmentInfo.buffer, index.points.buffer, index.pointInfo.buffer,
  index.segmentCells.buffer, index.segmentItems.buffer, index.pointCells.buffer, index.pointItems.buffer] as Transferable[];

/** Sträckorna som redan setts i frågan (per index, så att en sträcka i flera rutor bara prövas en gång). */
const stamps = new WeakMap<SnapIndex, { marks: Uint32Array; round: number }>();

interface Candidate { readonly a: Point; readonly b: Point; readonly target: SnapTarget; readonly distance: number; readonly t: number; readonly object: number }

function project(p: Point, a: Point, b: Point): { t: number; at: Point; distance: number } {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  const at = { x: a.x + t * dx, y: a.y + t * dy };
  return { t, at, distance: Math.hypot(p.x - at.x, p.y - at.y) };
}

/** Skärningen mellan sträckorna a–b och c–d (inte parallella), med läget på båda, eller undefined. */
function crossing(a: Point, b: Point, c: Point, d: Point): { at: Point; t: number; u: number } | undefined {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y, denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-12 * Math.max(1, Math.hypot(rx, ry) * Math.hypot(sx, sy))) return undefined;
  const qx = c.x - a.x, qy = c.y - a.y, t = (qx * sy - qy * sx) / denominator, u = (qx * ry - qy * rx) / denominator;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return undefined;
  return { at: { x: a.x + t * rx, y: a.y + t * ry }, t, u };
}

/**
 * Bästa fästpunkten inom `reachMm` från punkten: en punkt före en skärning före en kant (inom varje slag den närmaste), eller
 * undefined. Släckta symboler och uteslutna objekt fäster inte; `extra` (det egna utkastet) fäster som ett objekt utan nyckel.
 */
export function snapAt(index: SnapIndex | undefined, query: SnapQuery): SnapHit | undefined {
  const { point: p, reachMm: reach } = query;
  if (!(reach > 0)) return undefined;
  const skip = (object: number) => (query.hidden?.has(index!.symbols[object]!) ?? false) || (query.exclude?.has(index!.keys[object]!) ?? false);
  const targetOf = (object: number, part: number, item: number, extra?: Partial<SnapTarget>): SnapTarget =>
    ({ key: index!.keys[object], symbol: index!.symbols[object], part, index: item, ...extra });
  const own = (item: number, extra?: Partial<SnapTarget>): SnapTarget => ({ key: undefined, symbol: undefined, part: 0, index: item, ...extra });

  // 1) Punkterna.
  let vertex: SnapHit | undefined;
  const consider = (at: Point, target: () => SnapTarget) => {
    const distance = Math.hypot(at.x - p.x, at.y - p.y);
    if (distance <= reach && (!vertex || distance < vertex.distance)) vertex = { kind: "vertex", at, distance, target: target() };
  };
  const near: Candidate[] = [];
  if (index) {
    const { minX, minY, cell, cols, rows } = index.grid;
    const c0 = Math.max(0, Math.floor((p.x - reach - minX) / cell)), c1 = Math.min(cols - 1, Math.floor((p.x + reach - minX) / cell));
    const r0 = Math.max(0, Math.floor((p.y - reach - minY) / cell)), r1 = Math.min(rows - 1, Math.floor((p.y + reach - minY) / cell));
    if (c0 <= c1 && r0 <= r1) {
      const { points, pointInfo, pointCells, pointItems, segments, segmentInfo, segmentCells, segmentItems } = index;
      for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) {
        const cellIndex = r * cols + c;
        for (let i = pointCells[cellIndex]!; i < pointCells[cellIndex + 1]!; i += 1) {
          const item = pointItems[i]!, object = pointInfo[item * 3]!;
          if (skip(object)) continue;
          consider({ x: points[item * 2]!, y: points[item * 2 + 1]! }, () => targetOf(object, pointInfo[item * 3 + 1]!, pointInfo[item * 3 + 2]!));
        }
      }
      let stamp = stamps.get(index);
      if (!stamp) { stamp = { marks: new Uint32Array(segments.length / 4), round: 0 }; stamps.set(index, stamp); }
      stamp.round = (stamp.round + 1) >>> 0;
      if (stamp.round === 0) { stamp.marks.fill(0); stamp.round = 1; }
      const { marks, round } = stamp;
      for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) {
        const cellIndex = r * cols + c;
        for (let i = segmentCells[cellIndex]!; i < segmentCells[cellIndex + 1]!; i += 1) {
          const item = segmentItems[i]!;
          if (marks[item] === round) continue;
          marks[item] = round;
          const object = segmentInfo[item * 3]!;
          if (skip(object)) continue;
          const o = item * 4, a = { x: segments[o]!, y: segments[o + 1]! }, b = { x: segments[o + 2]!, y: segments[o + 3]! };
          const hit = project(p, a, b);
          if (hit.distance > reach) continue;
          near.push({ a, b, distance: hit.distance, t: hit.t, object,
            target: targetOf(object, segmentInfo[item * 3 + 1]!, segmentInfo[item * 3 + 2]!, { from: a, to: b }) });
        }
      }
    }
  }
  query.extra?.points.forEach((at, item) => consider(at, () => own(item)));
  if (vertex) return vertex;
  query.extra?.segments.forEach(([a, b], item) => {
    const hit = project(p, a, b);
    if (hit.distance <= reach) near.push({ a, b, distance: hit.distance, t: hit.t, object: -1, target: own(item, { from: a, to: b }) });
  });
  if (near.length === 0) return undefined;
  near.sort((x, y) => x.distance - y.distance);

  // 2) Skärningarna mellan de närmaste sträckorna (inte grannsträckor i samma linje: de möts i en punkt på linjen).
  let best: SnapHit | undefined;
  const pairs = near.slice(0, MAX_CROSSING);
  for (let i = 0; i < pairs.length; i += 1) for (let j = i + 1; j < pairs.length; j += 1) {
    const one = pairs[i]!, two = pairs[j]!;
    if (one.object === two.object && one.target.part === two.target.part && (Math.abs(one.target.index - two.target.index) <= 1
      || sharesEnd(one, two))) continue;
    const found = crossing(one.a, one.b, two.a, two.b);
    if (!found) continue;
    const distance = Math.hypot(found.at.x - p.x, found.at.y - p.y);
    if (distance <= reach && (!best || distance < best.distance)) {
      best = { kind: "intersection", at: found.at, distance, target: { ...one.target, t: found.t }, other: { ...two.target, t: found.u } };
    }
  }
  if (best) return best;

  // 3) Närmaste punkt på en linje eller kant.
  const closest = near[0]!;
  const at = { x: closest.a.x + closest.t * (closest.b.x - closest.a.x), y: closest.a.y + closest.t * (closest.b.y - closest.a.y) };
  return { kind: "edge", at, distance: closest.distance, target: { ...closest.target, t: closest.t } };
}

const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
const sharesEnd = (one: Candidate, two: Candidate) => same(one.a, two.a) || same(one.a, two.b) || same(one.b, two.a) || same(one.b, two.b);

/** Utkastets punkter som `extra`: de tidigare punkterna och sträckorna mellan dem, utan den senaste (som man ritar vidare från). */
export function draftExtra(points: readonly Point[]): SnapExtra {
  const earlier = points.slice(0, -1);
  return { points: earlier, segments: earlier.slice(1).map((at, index) => [earlier[index]!, at] as const) };
}

/** Objektets punkter och sträckor som `extra` (utan den punkt som dras och sträckorna till den). */
export function objectExtra(object: MapObject, without?: Point): SnapExtra {
  if (object.kind === "point" || object.kind === "text") return { points: [], segments: [] };
  const free = (at: Point) => !without || !same(at, without);
  const points = vertices(object).map(vertex => vertex.at).filter(free);
  const segments: [Point, Point][] = [];
  for (const part of objectParts(object)) for (const line of flattenPath(part)) for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1]!, b = line[i]!;
    if (free(a) && free(b)) segments.push([a, b]);
  }
  return { points, segments };
}

/** Objektets punkt närmast `point` (ankaret när ett helt objekt dras). */
export function nearestAnchor(object: MapObject, point: Point): Point | undefined {
  if (object.kind === "point" || object.kind === "text") return object.at;
  let best: Point | undefined, distance = Infinity;
  for (const vertex of vertices(object)) {
    const next = Math.hypot(vertex.at.x - point.x, vertex.at.y - point.y);
    if (next < distance) { best = vertex.at; distance = next; }
  }
  return best;
}
