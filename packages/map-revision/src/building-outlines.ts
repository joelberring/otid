import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import { flattenPath, type MapObject, type PathCommand, type Point } from "@o-tid/map-file";

/**
 * Kant runt husen (ägaren 2026-11-23: «husen blev helt svarta fast de ska bli grå med svart kant. om det bara finns en hatch
 * borde programmet göra en kant runt när det lägger in»). ISSprOM 2019-2 521: «black (outline), black 50%», och gränser
 * mellan hus som rör varandra ritas inte. När kartans byggnad (521) är en yta utan egen kant och kartan har en kantsymbol
 * (521.1 «Kant, byggnad»), ritas kanten som slutna linjer runt sammanhängande hus: husen som rör eller överlappar varandra slås
 * ihop (unionen, med gårdarna inuti som hål), så att gemensamma väggar inte får någon linje.
 *
 * `buildingOutlines` ger linjerna att lägga till och de befintliga kantlinjerna som ska bort (de som ligger längs husen som
 * räknas om). En befintlig kant som redan stämmer står kvar, så att åtgärden kan köras igen utan att något ändras.
 */
type Ring = Point[];
export interface OutlineObject { readonly key: string; readonly object: MapObject }
export interface OutlinePlan {
  /** Nya kantlinjer (slutna: sista punkten är den första). */
  readonly add: readonly MapObject[];
  /** Kantlinjer som ersätts. */
  readonly remove: readonly string[];
  /** Hus i de omräknade grupperna. */
  readonly houses: number;
}

/** Koordinaterna avrundas till 0,001 mm, så att hus som delar vägg i filen också delar den i unionen. */
const snap = (value: number) => Math.round(value * 1000) / 1000;
/** En kantlinje som ligger så här nära (mm) husens kant hör till dem. */
const HUG_MM = 0.05;
/** Så nära (mm) måste en befintlig kant följa den nya för att få stå kvar. */
const SAME_MM = 0.01;

const ringsOf = (object: MapObject): Ring[] => object.kind !== "area" ? []
  : object.rings.flatMap(path => flattenPath(path)).map(line => line.map(point => ({ x: snap(point.x), y: snap(point.y) })))
    .map(ring => ring.length > 1 && ring[0]!.x === ring.at(-1)!.x && ring[0]!.y === ring.at(-1)!.y ? ring.slice(0, -1) : ring)
    .filter(ring => ring.length >= 3);
const pointsOf = (object: MapObject): Point[] => object.kind === "line" ? flattenPath(object.path).flat() : [];

interface Box { minX: number; minY: number; maxX: number; maxY: number }
const boxOf = (points: readonly Point[]): Box => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};
const boxOfRings = (rings: readonly Ring[]): Box => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};
const overlaps = (a: Box, b: Box, margin: number) => a.minX <= b.maxX + margin && b.minX <= a.maxX + margin && a.minY <= b.maxY + margin && b.minY <= a.maxY + margin;

function segmentDistanceSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  const rx = p.x - (a.x + t * dx), ry = p.y - (a.y + t * dy);
  return rx * rx + ry * ry;
}

/**
 * Avståndskontroll mot en eller flera ringar utan `Math.min(...ring.map(...))` (stack-säker på stora ringar).
 * För stora ringar (> 64 segment) byggs ett spatialt cellindex över segmenten så kontrollen blir O(V) i stället för O(V^2).
 */
function makeRingMatcher(rings: readonly Ring[]): (p: Point, limit: number) => boolean {
  let total = 0;
  for (const ring of rings) total += ring.length;
  if (total <= 64) {
    return (p, limit) => {
      const limitSq = limit * limit;
      for (const ring of rings) {
        const n = ring.length;
        for (let i = 0; i < n; i += 1) {
          const a = ring[i]!, b = ring[(i + 1) % n]!;
          const minX = a.x < b.x ? a.x : b.x, maxX = a.x > b.x ? a.x : b.x;
          if (p.x < minX - limit || p.x > maxX + limit) continue;
          const minY = a.y < b.y ? a.y : b.y, maxY = a.y > b.y ? a.y : b.y;
          if (p.y < minY - limit || p.y > maxY + limit) continue;
          if (segmentDistanceSq(p, a, b) <= limitSq) return true;
        }
      }
      return false;
    };
  }
  const segA: Point[] = [], segB: Point[] = [];
  let sumSpan = 0, ox = Infinity, oy = Infinity;
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i += 1) {
      const a = ring[i]!, b = ring[(i + 1) % n]!;
      segA.push(a); segB.push(b);
      const minX = a.x < b.x ? a.x : b.x, minY = a.y < b.y ? a.y : b.y;
      if (minX < ox) ox = minX;
      if (minY < oy) oy = minY;
      sumSpan += Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }
  }
  const originX = Number.isFinite(ox) ? ox : 0, originY = Number.isFinite(oy) ? oy : 0;
  const cell = Math.max(HUG_MM * 4, Math.min(50, sumSpan / segA.length));
  const cells = new Map<number, number[]>(), overflow: number[] = [];
  for (let i = 0; i < segA.length; i += 1) {
    const a = segA[i]!, b = segB[i]!;
    const minX = a.x < b.x ? a.x : b.x, maxX = a.x > b.x ? a.x : b.x;
    const minY = a.y < b.y ? a.y : b.y, maxY = a.y > b.y ? a.y : b.y;
    const x0 = Math.floor((minX - originX) / cell), x1 = Math.floor((maxX - originX) / cell);
    const y0 = Math.floor((minY - originY) / cell), y1 = Math.floor((maxY - originY) / cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64 || Math.abs(x0) > 1e7 || Math.abs(x1) > 1e7 || Math.abs(y0) > 1e7 || Math.abs(y1) > 1e7) {
      overflow.push(i);
      continue;
    }
    for (let cx = x0; cx <= x1; cx += 1) for (let cy = y0; cy <= y1; cy += 1) {
      const key = (cx + 0x1000000) * 0x2000000 + (cy + 0x1000000);
      const list = cells.get(key);
      if (list) list.push(i); else cells.set(key, [i]);
    }
  }
  return (p, limit) => {
    const limitSq = limit * limit;
    const x0 = Math.floor((p.x - limit - originX) / cell), x1 = Math.floor((p.x + limit - originX) / cell);
    const y0 = Math.floor((p.y - limit - originY) / cell), y1 = Math.floor((p.y + limit - originY) / cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 64 && Math.abs(x0) <= 1e7 && Math.abs(x1) <= 1e7 && Math.abs(y0) <= 1e7 && Math.abs(y1) <= 1e7) {
      for (let cx = x0; cx <= x1; cx += 1) for (let cy = y0; cy <= y1; cy += 1) {
        const list = cells.get((cx + 0x1000000) * 0x2000000 + (cy + 0x1000000));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 1) {
          const idx = list[i]!;
          if (segmentDistanceSq(p, segA[idx]!, segB[idx]!) <= limitSq) return true;
        }
      }
      for (let i = 0; i < overflow.length; i += 1) {
        const idx = overflow[i]!;
        if (segmentDistanceSq(p, segA[idx]!, segB[idx]!) <= limitSq) return true;
      }
      return false;
    }
    for (let i = 0; i < segA.length; i += 1) {
      if (segmentDistanceSq(p, segA[i]!, segB[i]!) <= limitSq) return true;
    }
    return false;
  };
}

const toPolygon = (rings: readonly Ring[]): Polygon => rings.map(ring => [...ring.map(p => [p.x, p.y] as [number, number]), [ring[0]!.x, ring[0]!.y] as [number, number]]);
const fromMulti = (multi: MultiPolygon): Ring[] => multi.flatMap(polygon => polygon.map(ring => ring.slice(0, -1).map(([x, y]) => ({ x, y }))))
  .filter(ring => ring.length >= 3);

/** Spatialt cellindex för befintliga kantlinjer så varje husgrupp bara prövar närliggande kanter. */
class EdgeGrid<T extends { readonly box: Box }> {
  private readonly cells = new Map<number, number[]>();
  private readonly overflow: number[] = [];
  private readonly seen: Int32Array;
  private stamp = 0;
  private readonly cell: number;
  private readonly originX: number;
  private readonly originY: number;
  constructor(private readonly items: readonly T[]) {
    this.seen = new Int32Array(items.length);
    let sum = 0, ox = Infinity, oy = Infinity;
    for (const item of items) {
      sum += Math.max(item.box.maxX - item.box.minX, item.box.maxY - item.box.minY);
      if (item.box.minX < ox) ox = item.box.minX;
      if (item.box.minY < oy) oy = item.box.minY;
    }
    this.originX = Number.isFinite(ox) ? ox : 0;
    this.originY = Number.isFinite(oy) ? oy : 0;
    this.cell = items.length ? Math.max(1, Math.min(50, sum / items.length)) : 1;
    for (let i = 0; i < items.length; i += 1) {
      const b = items[i]!.box;
      const x0 = Math.floor((b.minX - this.originX) / this.cell), x1 = Math.floor((b.maxX - this.originX) / this.cell);
      const y0 = Math.floor((b.minY - this.originY) / this.cell), y1 = Math.floor((b.maxY - this.originY) / this.cell);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64 || Math.abs(x0) > 1e7 || Math.abs(x1) > 1e7 || Math.abs(y0) > 1e7 || Math.abs(y1) > 1e7) {
        this.overflow.push(i);
        continue;
      }
      for (let cx = x0; cx <= x1; cx += 1) for (let cy = y0; cy <= y1; cy += 1) {
        const key = (cx + 0x1000000) * 0x2000000 + (cy + 0x1000000);
        const list = this.cells.get(key);
        if (list) list.push(i); else this.cells.set(key, [i]);
      }
    }
  }
  query(box: Box, margin: number): T[] {
    const out: T[] = [];
    if (this.items.length === 0) return out;
    this.stamp += 1;
    if (this.stamp === 0x7fffffff) { this.seen.fill(0); this.stamp = 1; }
    const x0 = Math.floor((box.minX - margin - this.originX) / this.cell), x1 = Math.floor((box.maxX + margin - this.originX) / this.cell);
    const y0 = Math.floor((box.minY - margin - this.originY) / this.cell), y1 = Math.floor((box.maxY + margin - this.originY) / this.cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256 || Math.abs(x0) > 1e7 || Math.abs(x1) > 1e7 || Math.abs(y0) > 1e7 || Math.abs(y1) > 1e7) {
      for (let i = 0; i < this.items.length; i += 1) {
        if (overlaps(this.items[i]!.box, box, margin)) out.push(this.items[i]!);
      }
      return out;
    }
    for (let cx = x0; cx <= x1; cx += 1) for (let cy = y0; cy <= y1; cy += 1) {
      const list = this.cells.get((cx + 0x1000000) * 0x2000000 + (cy + 0x1000000));
      if (!list) continue;
      for (let i = 0; i < list.length; i += 1) {
        const idx = list[i]!;
        if (this.seen[idx] === this.stamp) continue;
        this.seen[idx] = this.stamp;
        const item = this.items[idx]!;
        if (overlaps(item.box, box, margin)) out.push(item);
      }
    }
    for (let i = 0; i < this.overflow.length; i += 1) {
      const idx = this.overflow[i]!;
      if (this.seen[idx] === this.stamp) continue;
      this.seen[idx] = this.stamp;
      const item = this.items[idx]!;
      if (overlaps(item.box, box, margin)) out.push(item);
    }
    return out;
  }
}

/** Grupper av hus vars rutor rör varandra (union–find, husen sorterade i x). */
function groups(boxes: readonly Box[]): number[][] {
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]!));
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a]!.minX - boxes[b]!.minX);
  for (let i = 0; i < order.length; i += 1) {
    const a = boxes[order[i]!]!;
    for (let j = i + 1; j < order.length && boxes[order[j]!]!.minX <= a.maxX + 0.001; j += 1) {
      if (overlaps(a, boxes[order[j]!]!, 0.001)) parent[find(order[i]!)] = find(order[j]!);
    }
  }
  const out = new Map<number, number[]>();
  for (let i = 0; i < boxes.length; i += 1) {
    const root = find(i), list = out.get(root);
    if (list) list.push(i); else out.set(root, [i]);
  }
  return [...out.values()];
}

/**
 * Kanten runt husen. `only`: bara grupperna med de här husen (markerade); utan den alla hus. `edges` är kartans befintliga
 * kantlinjer (kantsymbolens objekt), `edgeSymbol` symbolen de nya får.
 */
export function buildingOutlines(houses: readonly OutlineObject[], edges: readonly OutlineObject[], edgeSymbol: string,
  only?: ReadonlySet<string>): OutlinePlan {
  const shaped = houses.map(house => ({ key: house.key, rings: ringsOf(house.object) })).filter(house => house.rings.length > 0);
  const boxes = shaped.map(house => boxOf(house.rings[0]!));
  const edgeRows = edges.map(edge => ({ key: edge.key, points: pointsOf(edge.object) })).filter(edge => edge.points.length >= 2)
    .map(edge => ({ ...edge, box: boxOf(edge.points) }));
  const edgeGrid = new EdgeGrid(edgeRows);
  const add: MapObject[] = [], remove = new Set<string>(), kept = new Set<string>();
  let count = 0;
  for (const members of groups(boxes)) {
    if (only && !members.some(i => only.has(shaped[i]!.key))) continue;
    count += members.length;
    let union: Ring[];
    try {
      const [first, ...rest] = members.map(i => toPolygon(shaped[i]!.rings));
      union = fromMulti(rest.length ? polygonClipping.union(first!, ...rest) : [first!]);
    } catch {
      // En trasig ring (självkorsande yta) ger varje hus sin egen kant.
      union = members.flatMap(i => shaped[i]!.rings);
    }
    if (union.length === 0) continue;
    const box = boxOfRings(union);
    const candidates = edgeGrid.query(box, HUG_MM);
    const nearUnion = candidates.length ? makeRingMatcher(union) : undefined;
    const hugging = nearUnion ? candidates.filter(edge => !kept.has(edge.key)
      && edge.points.every(point => nearUnion(point, HUG_MM))) : [];
    const edgeMatchers = new Map<string, (p: Point, limit: number) => boolean>();
    const matcherForEdge = (edge: (typeof hugging)[number]) => {
      let m = edgeMatchers.get(edge.key);
      if (!m) { m = makeRingMatcher([edge.points]); edgeMatchers.set(edge.key, m); }
      return m;
    };
    for (const ring of union) {
      const ringBox = boxOf(ring);
      let nearRing: ((p: Point, limit: number) => boolean) | undefined;
      const same = hugging.find(edge => {
        if (kept.has(edge.key) || edge.points.length < ring.length || !overlaps(edge.box, ringBox, SAME_MM)) return false;
        nearRing ??= makeRingMatcher([ring]);
        if (!edge.points.every(point => nearRing!(point, SAME_MM))) return false;
        const nearEdge = matcherForEdge(edge);
        return ring.every(point => nearEdge(point, SAME_MM));
      });
      if (same) { kept.add(same.key); continue; }
      const path: PathCommand[] = [...ring, ring[0]!].map((point, index) => ({ type: index === 0 ? "M" : "L", x: point.x, y: point.y }));
      add.push({ kind: "line", symbol: edgeSymbol, path });
    }
    for (const edge of hugging) if (!kept.has(edge.key)) remove.add(edge.key);
  }
  return { add, remove: [...remove], houses: count };
}
