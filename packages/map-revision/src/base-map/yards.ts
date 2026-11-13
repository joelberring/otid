import type { SourceFeature } from "../index";
import { faceAt, facesFromLines } from "../faces";

/**
 * Grundkartan G8, tomter (ägaren 2026-11-11: «tomter kommer inte med»). Varken lasern, marktäcket eller OpenStreetMap har
 * tomtgränser, så en första tomt räknas ur husen och blir lagret `tomtmark_hus` (förslag 520, område som inte får beträdas).
 * Fastighetsgränser används inte (personuppgifter).
 *
 * Ägaren 2026-11-13 («gokartor gör fyrkanter som klippt mot vägar. jag tycker det ser snyggare ut än runda ytor»): tomten är
 * en rektangel, inte en rundad ring. Bostadsstora hus (högst `maxBuilding` m²) som ligger högst `link` meter från varandra utan
 * väg emellan hör till samma tomt; rektangeln är den minsta som rymmer husens hörn, vriden efter husen, och vidgad `radius`
 * meter åt alla håll. Den klipps mot vägar och strand: bara delarna där husen står blir kvar. Ett grovt förslag att rätta på plats.
 */
export interface YardSettings { readonly radius: number; readonly link: number; readonly maxBuilding: number; readonly minArea: number }
export const DEFAULT_YARDS: YardSettings = { radius: 15, link: 45, maxBuilding: 400, minArea: 300 };
const BUILDING = /^(byggnad|OSM byggnad)$/;
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

/** Tomterna kring husen i `features` (meter, SWEREF 99 TM eller annat metriskt system) som slutna linjer i lagret `tomtmark_hus`. */
export function yardsOf(features: readonly SourceFeature[], settings: YardSettings = DEFAULT_YARDS): SourceFeature[] {
  // Hus som redan ligger i en tomt (OpenStreetMaps bostadsområde, marktäckets låga bebyggelse) får ingen egen tomt.
  const yards = features.filter(feature => /^tomtmark_/.test(feature.layer)).map(outerRing).filter((ring): ring is Ring => !!ring && ring.length >= 3);
  const houses = features.filter(feature => BUILDING.test(feature.layer)).map(outerRing)
    .filter((ring): ring is Ring => !!ring && ring.length >= 3 && ringArea(ring) <= settings.maxBuilding)
    .filter(ring => { const [x, y] = centroid(ring); return !yards.some(yard => inside(yard, x, y)); });
  if (!houses.length) return [];
  const cuts: { points: Point[]; closed: boolean; box: [number, number, number, number] }[] = [];
  for (const feature of features) {
    if (!CUT.test(feature.layer)) continue;
    const parts: { points: readonly Point[]; closed: boolean }[] = feature.geometry.kind === "line" ? [{ points: feature.geometry.points, closed: !!feature.geometry.closed }]
      : feature.geometry.kind === "area" ? feature.geometry.rings.map(ring => ({ points: ring, closed: true })) : [];
    for (const part of parts) {
      if (part.points.length < 2) continue;
      const xs = part.points.map(p => p[0]), ys = part.points.map(p => p[1]);
      cuts.push({ points: [...part.points], closed: part.closed, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    }
  }
  const segments = (cut: (typeof cuts)[number]) => cut.points.map((point, i) => [point, cut.points[(i + 1) % cut.points.length]!] as const).slice(0, cut.closed ? undefined : -1);
  const separated = (a: Point, b: Point) => cuts.some(cut => cut.box[0] <= Math.max(a[0], b[0]) && cut.box[2] >= Math.min(a[0], b[0]) && cut.box[1] <= Math.max(a[1], b[1])
    && cut.box[3] >= Math.min(a[1], b[1]) && segments(cut).some(([c, d]) => crosses(a, b, c, d)));
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
    for (const i of order) groups.set(find(i), [...(groups.get(find(i)) ?? []), i]);
    return [...groups.values()];
  };
  // En gles grupp (rektangeln mest tom mark, t.ex. hus i vinkel) delas i tätare grupper tills rektanglarna är fyllda.
  const own = houses.map(ring => ringArea(yardRectangle(ring, settings.radius)));
  const split = (members: number[], link: number): number[][] => {
    if (members.length < 2) return [members];
    const area = ringArea(yardRectangle(members.flatMap(i => houses[i]!), settings.radius));
    if (area <= 1.3 * members.reduce((sum, i) => sum + own[i]!, 0)) return [members];
    const parts = cluster(members, link * 0.6);
    return parts.length > 1 || link > 2 ? parts.flatMap(part => split(part, link * 0.6)) : members.map(i => [i]);
  };
  const groups = cluster(houses.map((_, i) => i), settings.link).flatMap(members => split(members, settings.link));
  const out: SourceFeature[] = [];
  for (const members of groups) {
    const rectangle = yardRectangle(members.flatMap(i => houses[i]!), settings.radius);
    const xs = rectangle.map(p => p[0]), ys = rectangle.map(p => p[1]), box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
    const near = cuts.filter(cut => cut.box[0] <= box[2] && cut.box[2] >= box[0] && cut.box[1] <= box[3] && cut.box[3] >= box[1]);
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
