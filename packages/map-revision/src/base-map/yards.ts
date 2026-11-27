import type { SourceFeature } from "../index";
import { faceAt, facesFromLines } from "../faces";

/**
 * Grundkartan G8, tomter (ägaren 2026-11-11: «tomter kommer inte med»). Varken lasern, marktäcket eller OpenStreetMap har
 * tomtgränser, så en första tomt räknas ur husen och blir lagret `tomtmark_hus` (förslag 520, område som inte får beträdas).
 * Ägaren 2026-11-16: med Lantmäteriets fastighetsindelning (lagret `fastighet`, bara geometrin) blir en fastighet under
 * `PARCEL_MAX_M2` med ett hus i hela tomten (`tomtmark_fastighet`, `parcelYards`); husen där får ingen rektangel.
 *
 * Ägaren 2026-11-13 («gokartor gör fyrkanter som klippt mot vägar. jag tycker det ser snyggare ut än runda ytor»): tomten är
 * en rektangel, inte en rundad ring. Bostadsstora hus (högst `maxBuilding` m²) som ligger högst `link` meter från varandra utan
 * väg emellan hör till samma tomt; rektangeln är den minsta som rymmer husens hörn, vriden efter husen, och vidgad `radius`
 * meter åt alla håll. Den klipps mot vägar och strand: bara delarna där husen står blir kvar. Ett grovt förslag att rätta på plats.
 *
 * Ägaren 2026-11-14 («gör tomtmarken lite lite större men ta bort det för väldigt små byggnader»): 18 m i stället för 15, och en
 * grupp där inget hus är större än `minBuilding` m² (bod, jordkällare, bastu för sig) får ingen tomt. Ett litet hus intill ett
 * riktigt hör fortfarande till tomten.
 */
export interface YardSettings { readonly radius: number; readonly link: number; readonly maxBuilding: number; readonly minBuilding: number; readonly minArea: number }
export const DEFAULT_YARDS: YardSettings = { radius: 18, link: 45, maxBuilding: 400, minBuilding: 20, minArea: 300 };
const BUILDING = /^(byggnad|OSM byggnad)$/;
const DENSITY_MARGIN = 15;
type Ring = readonly (readonly [number, number])[];

const ringArea = (ring: Ring) => Math.abs(ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0)) / 2;
function inside(ring: Ring, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const outerRing = (feature: SourceFeature): Ring | undefined => feature.geometry.kind === "area" ? feature.geometry.rings[0]
  : feature.geometry.kind === "line" && feature.geometry.closed ? feature.geometry.points : undefined;

/** Det som delar en tomt: vägar (inte stigar) och stranden. */
const CUT = /^(OSM väg|OSM traktorväg|OSM järnväg|vatten$|strandlinje$)/;
type Point = readonly [number, number];
const centroid = (ring: Ring): Point => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
/** Korsar sträckorna varandra (äkta korsning)? */
const crosses = (a: Point, b: Point, c: Point, d: Point) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;

function hull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]), out: Point[] = [];
  for (const pass of [sorted, [...sorted].reverse()]) {
    const start = out.length;
    for (const point of pass) {
      while (out.length >= start + 2 && cross(out[out.length - 2]!, out[out.length - 1]!, point) <= 0) out.pop();
      out.push(point);
    }
    out.pop();
  }
  return out;
}

/** Den minsta rektangeln kring punkterna (en sida längs någon av höljets kanter), vidgad `margin` åt alla håll. */
export function yardRectangle(points: readonly Point[], margin: number): Point[] {
  const shell = hull(points);
  let best: { area: number; ux: number; uy: number; u0: number; u1: number; v0: number; v1: number } | undefined;
  for (let i = 0; i < Math.max(1, shell.length); i += 1) {
    const a = shell[i] ?? points[0]!, b = shell[(i + 1) % Math.max(1, shell.length)] ?? a, length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = length > 1e-9 ? (b[0] - a[0]) / length : 1, uy = length > 1e-9 ? (b[1] - a[1]) / length : 0;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of points) { const u = x * ux + y * uy, v = -x * uy + y * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-9) best = { area, ux, uy, u0, u1, v0, v1 };
  }
  const { ux, uy, u0, u1, v0, v1 } = best!;
  const at = (u: number, v: number): Point => [u * ux - v * uy, u * uy + v * ux];
  return [at(u0 - margin, v0 - margin), at(u1 + margin, v0 - margin), at(u1 + margin, v1 + margin), at(u0 - margin, v1 + margin)];
}

type Box = readonly [number, number, number, number];
const boxOfPoints = (points: readonly Point[]): Box => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const [x, y] = points[i]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
};
const touchesBox = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** Spatialt rutnätsindex över rutor/punkter i meter för att slippa O(N^2)-skanningar. */
class SpatialGrid<T extends { readonly box: Box }> {
  private readonly cells = new Map<number, number[]>();
  private readonly overflow: number[] = [];
  private readonly seen: Int32Array;
  private stamp = 0;
  private readonly cell: number;
  private readonly originX: number;
  private readonly originY: number;
  constructor(private readonly items: readonly T[], defaultCell = 50) {
    this.seen = new Int32Array(items.length);
    let sum = 0, ox = Infinity, oy = Infinity;
    for (const item of items) {
      sum += Math.max(item.box[2] - item.box[0], item.box[3] - item.box[1]);
      if (item.box[0] < ox) ox = item.box[0];
      if (item.box[1] < oy) oy = item.box[1];
    }
    this.originX = Number.isFinite(ox) ? ox : 0;
    this.originY = Number.isFinite(oy) ? oy : 0;
    this.cell = items.length ? Math.max(10, Math.min(250, sum / items.length || defaultCell)) : defaultCell;
    for (let i = 0; i < items.length; i += 1) {
      const b = items[i]!.box;
      const x0 = Math.floor((b[0] - this.originX) / this.cell), x1 = Math.floor((b[2] - this.originX) / this.cell);
      const y0 = Math.floor((b[1] - this.originY) / this.cell), y1 = Math.floor((b[3] - this.originY) / this.cell);
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
  someInBox(box: Box, test: (item: T) => boolean): boolean {
    if (this.items.length === 0) return false;
    this.stamp += 1;
    if (this.stamp === 0x7fffffff) { this.seen.fill(0); this.stamp = 1; }
    const x0 = Math.floor((box[0] - this.originX) / this.cell), x1 = Math.floor((box[2] - this.originX) / this.cell);
    const y0 = Math.floor((box[1] - this.originY) / this.cell), y1 = Math.floor((box[3] - this.originY) / this.cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256 || Math.abs(x0) > 1e7 || Math.abs(x1) > 1e7 || Math.abs(y0) > 1e7 || Math.abs(y1) > 1e7) {
      for (let i = 0; i < this.items.length; i += 1) {
        const item = this.items[i]!;
        if (touchesBox(item.box, box) && test(item)) return true;
      }
      return false;
    }
    for (let cx = x0; cx <= x1; cx += 1) for (let cy = y0; cy <= y1; cy += 1) {
      const list = this.cells.get((cx + 0x1000000) * 0x2000000 + (cy + 0x1000000));
      if (!list) continue;
      for (let i = 0; i < list.length; i += 1) {
        const idx = list[i]!;
        if (this.seen[idx] === this.stamp) continue;
        this.seen[idx] = this.stamp;
        const item = this.items[idx]!;
        if (touchesBox(item.box, box) && test(item)) return true;
      }
    }
    for (let i = 0; i < this.overflow.length; i += 1) {
      const idx = this.overflow[i]!;
      if (this.seen[idx] === this.stamp) continue;
      this.seen[idx] = this.stamp;
      const item = this.items[idx]!;
      if (touchesBox(item.box, box) && test(item)) return true;
    }
    return false;
  }
  queryBox(box: Box): T[] {
    const out: T[] = [];
    this.someInBox(box, item => { out.push(item); return false; });
    return out;
  }
}

/** Tomterna kring husen i `features` (meter, SWEREF 99 TM eller annat metriskt system) som slutna linjer i lagret `tomtmark_hus`. */
export function yardsOf(features: readonly SourceFeature[], settings: YardSettings = DEFAULT_YARDS): SourceFeature[] {
  // Hus som redan ligger i en tomt (OpenStreetMaps bostadsområde, marktäckets låga bebyggelse) får ingen egen tomt.
  const yards = features.filter(feature => /^tomtmark_/.test(feature.layer)).map(outerRing)
    .filter((ring): ring is Ring => !!ring && ring.length >= 3)
    .map(ring => ({ ring, box: boxOfPoints(ring) }));
  const yardGrid = new SpatialGrid(yards);
  const houses = features.filter(feature => BUILDING.test(feature.layer)).map(outerRing)
    .filter((ring): ring is Ring => !!ring && ring.length >= 3 && ringArea(ring) <= settings.maxBuilding)
    .filter(ring => {
      const [x, y] = centroid(ring);
      return !yardGrid.someInBox([x, y, x, y], yard => inside(yard.ring, x, y));
    });
  if (!houses.length) return [];
  const cuts: { points: Point[]; closed: boolean; box: Box }[] = [];
  for (const feature of features) {
    if (!CUT.test(feature.layer)) continue;
    const parts: { points: readonly Point[]; closed: boolean }[] = feature.geometry.kind === "line" ? [{ points: feature.geometry.points, closed: !!feature.geometry.closed }]
      : feature.geometry.kind === "area" ? feature.geometry.rings.map(ring => ({ points: ring, closed: true })) : [];
    for (const part of parts) {
      if (part.points.length < 2) continue;
      cuts.push({ points: [...part.points], closed: part.closed, box: boxOfPoints(part.points) });
    }
  }
  const cutGrid = new SpatialGrid(cuts);
  const cutCrosses = (cut: (typeof cuts)[number], a: Point, b: Point): boolean => {
    const pts = cut.points, count = cut.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i += 1) {
      if (crosses(a, b, pts[i]!, pts[(i + 1) % pts.length]!)) return true;
    }
    return false;
  };
  const separated = (a: Point, b: Point) => cutGrid.someInBox(
    [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])],
    cut => cutCrosses(cut, a, b)
  );
  const centers = houses.map(centroid);
  // Grannar utan väg emellan hör ihop (union–find; husen sorteras i x så att bara nära hus jämförs).
  const cluster = (indices: readonly number[], link: number): number[][] => {
    const order = [...indices].sort((a, b) => centers[a]![0] - centers[b]![0]);
    const parent = new Map(order.map(i => [i, i])), find = (i: number): number => { const up = parent.get(i)!; if (up === i) return i; const root = find(up); parent.set(i, root); return root; };
    for (let i = 0; i < order.length; i += 1) for (let j = i + 1; j < order.length; j += 1) {
      const a = centers[order[i]!]!, b = centers[order[j]!]!;
      if (b[0] - a[0] > link) break;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= link && find(order[i]!) !== find(order[j]!) && !separated(a, b)) parent.set(find(order[i]!), find(order[j]!));
    }
    const groups = new Map<number, number[]>();
    for (const i of order) {
      const root = find(i), list = groups.get(root);
      if (list) list.push(i); else groups.set(root, [i]);
    }
    return [...groups.values()];
  };
  // En gles grupp (rektangeln mest tom mark, t.ex. hus i vinkel) delas i tätare grupper tills rektanglarna är fyllda.
  // Tätheten mäts med en fast marginal, så att en större tomtmarginal inte gör glesa grupper täta.
  const own = houses.map(ring => ringArea(yardRectangle(ring, DENSITY_MARGIN)));
  const split = (members: number[], link: number): number[][] => {
    if (members.length < 2) return [members];
    const area = ringArea(yardRectangle(members.flatMap(i => houses[i]!), DENSITY_MARGIN));
    if (area <= 1.3 * members.reduce((sum, i) => sum + own[i]!, 0)) return [members];
    const parts = cluster(members, link * 0.6);
    return parts.length > 1 || link > 2 ? parts.flatMap(part => split(part, link * 0.6)) : members.map(i => [i]);
  };
  const groups = cluster(houses.map((_, i) => i), settings.link).flatMap(members => split(members, settings.link));
  const out: SourceFeature[] = [];
  const size = houses.map(ringArea);
  for (const members of groups) {
    if (!members.some(i => size[i]! >= settings.minBuilding)) continue;
    const rectangle = yardRectangle(members.flatMap(i => houses[i]!), settings.radius);
    const box = boxOfPoints(rectangle);
    const near = cutGrid.queryBox(box);
    let rings: Point[][] = [rectangle];
    if (near.length) {
      const { faces } = facesFromLines([{ id: "tomt", points: rectangle.map(([x, y]) => ({ x, y })), closed: true },
        ...near.map((cut, i) => ({ id: `klipp${i}`, points: cut.points.map(([x, y]) => ({ x, y })), closed: cut.closed }))], { gapTolerance: 0 });
      // Bara rutorna inom rektangeln där något av husen står; en väg som slutar inne på tomten delar den inte.
      const kept = new Set(members.map(i => faceAt(faces, { x: centers[i]![0], y: centers[i]![1] })).filter(face => !!face));
      if (kept.size) rings = [...kept].map(face => face.outer.map(point => [point.x, point.y] as const));
    }
    for (const ring of rings) {
      if (ring.length >= 3 && ringArea(ring) >= settings.minArea) out.push({ layer: "tomtmark_hus", geometry: { kind: "line", closed: true, points: ring.map(([x, y]) => [x, y] as [number, number]) } });
    }
  }
  return out;
}

/** Ägaren 2026-11-16: «små ganska rektangulära ytor under 3–4000 kvadrat är tomter, över det skogs- och lantbruksfastigheter». */
export const PARCEL_MAX_M2 = 3500;
/**
 * Fastighetsytorna (`fastighet`) under `PARCEL_MAX_M2` där minst ett hus (minst `minBuilding` m²) står blir `tomtmark_fastighet`;
 * övriga fastigheter tas bort (de är ingen kartsymbol). Utan fastighetsindelning är listan oförändrad.
 */
export function parcelYards(features: readonly SourceFeature[], settings: YardSettings = DEFAULT_YARDS): SourceFeature[] {
  if (!features.some(feature => feature.layer === "fastighet")) return [...features];
  const centerGrid = new SpatialGrid(
    features.filter(feature => BUILDING.test(feature.layer)).map(outerRing)
      .filter((ring): ring is Ring => !!ring && ring.length >= 3 && ringArea(ring) >= settings.minBuilding)
      .map(ring => { const at = centroid(ring); return { at, box: [at[0], at[1], at[0], at[1]] as Box }; }),
    50
  );
  return features.flatMap(feature => {
    if (feature.layer !== "fastighet") return [feature];
    const ring = outerRing(feature);
    if (!ring || ring.length < 3 || ringArea(ring) > PARCEL_MAX_M2) return [];
    const box = boxOfPoints(ring);
    const built = centerGrid.someInBox(box, ({ at: [x, y] }) => inside(ring, x, y));
    return built ? [{ ...feature, layer: "tomtmark_fastighet" }] : [];
  });
}

/**
 * Sprintkartor (ägaren 2026-11-23, Liljeholmen och Gröndal: olivgröna 520 täckte hela gårdar kring flerbostadshus). ISSprOM
 * 2019-2 520 är «an area that shall not be entered such as a private area, a flower bed …»: privata trädgårdar, inte gårdarna
 * mellan flerbostadshus, som normalt är öppna och ritas som öppen mark, belagd yta osv. På en sprintkarta tas därför varje
 * tomtyta (`tomtmark_*`: OpenStreetMaps bostadsområden, marktäckets låga bebyggelse, fastigheterna och rektanglarna kring hus)
 * bort när ett hus större än `maxBuilding` (400 m², större än ett småhus) står i den eller skär in i den. Husen tas ur
 * `buildings` (Lantmäteriets och OpenStreetMaps, också där en huvudkälla ersätter dem i kartan).
 */
export function privateYardsOnly(features: readonly SourceFeature[], buildings: readonly SourceFeature[], settings: YardSettings = DEFAULT_YARDS): SourceFeature[] {
  const big = buildings.filter(feature => BUILDING.test(feature.layer)).map(outerRing)
    .filter((ring): ring is Ring => !!ring && ring.length >= 3 && ringArea(ring) > settings.maxBuilding)
    .map(ring => ({ ring, center: centroid(ring), box: boxOfPoints(ring) }));
  if (!big.length) return [...features];
  const bigGrid = new SpatialGrid(big);
  return features.filter(feature => {
    if (!/^tomtmark_/.test(feature.layer)) return true;
    const yard = outerRing(feature);
    if (!yard || yard.length < 3) return true;
    const box = boxOfPoints(yard);
    return !bigGrid.someInBox(box, house =>
      inside(yard, house.center[0], house.center[1])
      || house.ring.some(([x, y]) => inside(yard, x, y))
      || yard.some(([x, y]) => inside(house.ring, x, y)));
  });
}
