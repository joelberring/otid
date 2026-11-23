import { flattenPath, type MapObject, type Point } from "@o-tid/map-file";
import { codeParts } from "./map-norm";

/**
 * Ägaren 2026-11-23 efter «Rätta efter sprintnormen» på Liljeholmen och Gröndal: «man borde ha någon inställning att kärr och
 * bäckar inte skapas i områden som verkar bebyggda när man tar fram sprintkartor? detsamma gäller stigar mitt i vägar?».
 * Ren geometri i kartans mm (y uppåt), samma regler för kandidaterna när grundkartan eller en fil läses in (`candidates.ts`)
 * och för «Rätta efter sprintnormen» i en befintlig karta:
 *
 * - **Kärr och bäckar i bebyggt** (`waterInBuiltPlan`): bebyggt är inom `metres` (förval 25 m) från hus och skärmtak
 *   (521, 522), hårdgjord yta (501 och kanten 501.1) eller tomtmark (520). En sankmark tas bort när minst hälften av den ligger
 *   där; ett dike eller en bäck klipps så att bara delarna utanför står kvar (bitar under 1 mm tas bort).
 * - **Stigar i vägar** (`pathsInRoadsPlan`): delar av en stig (505–507) inne i en hårdgjord yta (501), längs en kant (501.1 eller
 *   ytans kant, parallellt inom `ROAD_SIDE_METRES`) eller mellan två parallella kanter högst `ROAD_HALF_WIDTH_METRES` bort på var
 *   sida (mitt i en gata som bara har kantlinjer) tas bort; en stig som korsar vägen står kvar fram till kanten.
 * - **Små kantringar** (`smallEdgeRingKeys`): slutna kantlinjer (501.1) som är för små eller smala för att synas som en ö
 *   (Stockholms refuger och stolpfundament blev «D» och «ɑ» längs gångvägarna).
 */
export interface CodedObject { readonly key: string; readonly code: string; readonly object: MapObject }

/** Förvalet för «bebyggt» (meter i terrängen), och reglagets gränser. */
export const SPRINT_BUILT_METRES = 25;
export const SPRINT_BUILT_RANGE = { min: 5, max: 60 } as const;
/** En stig längs en kant inom så många meter ligger i vägen. */
export const ROAD_SIDE_METRES = 3;
/** Mitt i en gata som bara har kantlinjer: en parallell kant på var sida inom så många meter. */
export const ROAD_HALF_WIDTH_METRES = 8;

/** Huvudnummer som räknas som bebyggt, och sankmarkens och vattendragens nummer som tas bort där. */
const BUILT_AREAS = new Set([501, 520, 521, 522]);
const isEdge = (code: string) => { const { main, sub } = codeParts(code); return main === 501 && sub === 1; };
/** Sankmark (307–310), diken och små bäckar (305, 306). 304 Bäck, överkomlig (ett riktigt vattendrag) står kvar. */
export const isWaterInBuiltCode = (code: string) => { const main = codeParts(code).main; return main >= 305 && main <= 310; };
export const isPathCode = (code: string) => { const main = codeParts(code).main; return main >= 505 && main <= 507; };
export const isBuiltCode = (code: string) => BUILT_AREAS.has(codeParts(code).main);
export const isPavedEdgeCode = isEdge;

export interface CleanPlan {
  /** Objekten som tas bort helt. */
  readonly remove: readonly string[];
  /** Objekten som klipps: delarna som står kvar (första ersätter objektet, resten läggs till). */
  readonly replace: readonly { readonly key: string; readonly objects: readonly MapObject[] }[];
}

type Ring = readonly Point[];
interface Box { minX: number; minY: number; maxX: number; maxY: number }
interface Segment { ax: number; ay: number; bx: number; by: number }

const boxOf = (points: readonly Point[]): Box => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { x, y } of points) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { minX, minY, maxX, maxY };
};
const inRing = (ring: Ring, x: number, y: number) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};
const lengthOf = (points: readonly Point[]) => points.reduce((sum, point, i) => i === 0 ? 0 : sum + Math.hypot(point.x - points[i - 1]!.x, point.y - points[i - 1]!.y), 0);
const ringArea = (ring: Ring) => Math.abs(ring.reduce((sum, point, i) => { const next = ring[(i + 1) % ring.length]!; return sum + point.x * next.y - next.x * point.y; }, 0)) / 2;

/** Rutnät över föremål med en ruta, för att bara pröva det som ligger nära. */
class Grid<T> {
  private readonly cells = new Map<string, T[]>();
  constructor(private readonly cell: number) {}
  add(box: Box, item: T) {
    for (let cx = Math.floor(box.minX / this.cell); cx <= Math.floor(box.maxX / this.cell); cx += 1)
      for (let cy = Math.floor(box.minY / this.cell); cy <= Math.floor(box.maxY / this.cell); cy += 1) {
        const key = `${cx},${cy}`, list = this.cells.get(key);
        if (list) list.push(item); else this.cells.set(key, [item]);
      }
  }
  near(x: number, y: number, radius: number): Set<T> {
    const found = new Set<T>();
    for (let cx = Math.floor((x - radius) / this.cell); cx <= Math.floor((x + radius) / this.cell); cx += 1)
      for (let cy = Math.floor((y - radius) / this.cell); cy <= Math.floor((y + radius) / this.cell); cy += 1)
        for (const item of this.cells.get(`${cx},${cy}`) ?? []) found.add(item);
    return found;
  }
}

/** Ytorna (ringar, yttre först) och linjerna som en annan regel prövar avstånd och läge mot. */
export interface Shapes { readonly polygons: readonly (readonly Ring[])[]; readonly lines: readonly Ring[] }

/** Avstånd till och läge i en samling ytor och linjer (kartans mm). */
export class Proximity {
  private readonly segments: Grid<Segment>;
  private readonly polygons: Grid<{ rings: readonly Ring[]; box: Box }>;
  constructor(shapes: Shapes, cell: number) {
    this.segments = new Grid(Math.max(cell, 0.5));
    this.polygons = new Grid(Math.max(cell, 0.5) * 4);
    const addLine = (points: readonly Point[]) => {
      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1]!, b = points[i]!;
        this.segments.add(boxOf([a, b]), { ax: a.x, ay: a.y, bx: b.x, by: b.y });
      }
    };
    for (const rings of shapes.polygons) {
      const outer = rings[0];
      if (!outer || outer.length < 3) continue;
      this.polygons.add(boxOf(outer), { rings, box: boxOf(outer) });
      for (const ring of rings) addLine([...ring, ring[0]!]);
    }
    for (const line of shapes.lines) addLine(line);
  }

  inside(x: number, y: number): boolean {
    for (const { rings, box } of this.polygons.near(x, y, 0)) {
      if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY) continue;
      if (inRing(rings[0]!, x, y) && !rings.slice(1).some(hole => inRing(hole, x, y))) return true;
    }
    return false;
  }

  /** Inne i en yta eller högst `distance` från en kant eller linje. */
  near(x: number, y: number, distance: number): boolean {
    if (this.inside(x, y)) return true;
    for (const segment of this.segments.near(x, y, distance)) if (segmentDistance(segment, x, y) <= distance) return true;
    return false;
  }

  /**
   * En kant parallellt med riktningen (`dx`, `dy`, enhetsvektor; högst 25° isär) inom `side`, eller en på var sida inom `half`.
   */
  along(x: number, y: number, dx: number, dy: number, side: number, half: number): boolean {
    let left = false, right = false;
    for (const segment of this.segments.near(x, y, Math.max(side, half))) {
      const sx = segment.bx - segment.ax, sy = segment.by - segment.ay, length = Math.hypot(sx, sy);
      if (length === 0 || Math.abs((sx * dx + sy * dy) / length) < PARALLEL_COS) continue;
      const distance = segmentDistance(segment, x, y);
      if (distance <= side) return true;
      if (distance > half) continue;
      // Vilken sida kanten ligger på, sett i stigens riktning.
      const cross = dx * (segment.ay + sy / 2 - y) - dy * (segment.ax + sx / 2 - x);
      if (cross > 0) left = true; else right = true;
      if (left && right) return true;
    }
    return false;
  }
}
const PARALLEL_COS = Math.cos(25 * Math.PI / 180);

function segmentDistance(segment: Segment, x: number, y: number): number {
  const dx = segment.bx - segment.ax, dy = segment.by - segment.ay, length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - segment.ax) * dx + (y - segment.ay) * dy) / length));
  return Math.hypot(x - segment.ax - t * dx, y - segment.ay - t * dy);
}

/** Ytornas ringar och linjernas punkter (kurvor plattade). */
const ringsOf = (object: MapObject): Ring[] => object.kind === "area" ? object.rings.map(path => flattenPath(path).flat()).filter(ring => ring.length >= 3) : [];
const linesOf = (object: MapObject): Ring[] => object.kind === "line" ? flattenPath(object.path).filter(line => line.length >= 2) : [];

/** Bebyggt ur kartans objekt: ytorna 501, 520, 521, 522 och kantlinjerna 501.1. */
export function builtShapes(objects: readonly CodedObject[]): Shapes {
  const polygons: Ring[][] = [], lines: Ring[] = [];
  for (const row of objects) {
    if (row.object.kind === "area" && isBuiltCode(row.code)) { const rings = ringsOf(row.object); if (rings.length) polygons.push(rings); }
    else if (row.object.kind === "line" && isEdge(row.code)) lines.push(...linesOf(row.object));
  }
  return { polygons, lines };
}
/** Vägarna: hårdgjorda ytor (501, inte 501.1) och kantlinjerna 501.1. */
export function roadShapes(objects: readonly CodedObject[]): Shapes {
  const polygons: Ring[][] = [], lines: Ring[] = [];
  for (const row of objects) {
    const { main } = codeParts(row.code);
    if (row.object.kind === "area" && main === 501) { const rings = ringsOf(row.object); if (rings.length) polygons.push(rings); }
    else if (row.object.kind === "line" && isEdge(row.code)) lines.push(...linesOf(row.object));
  }
  return { polygons, lines };
}
const joinShapes = (a: Shapes, b: Shapes | undefined): Shapes => b ? { polygons: [...a.polygons, ...b.polygons], lines: [...a.lines, ...b.lines] } : a;

/** Linjen med punkter högst `step` isär (originalets brytpunkter står kvar). */
function densify(points: readonly Point[], step: number): Point[] {
  const out: Point[] = [];
  points.forEach((point, i) => {
    if (i > 0) {
      const from = points[i - 1]!, length = Math.hypot(point.x - from.x, point.y - from.y), parts = Math.ceil(length / step);
      for (let k = 1; k < parts; k += 1) out.push({ x: from.x + (point.x - from.x) * k / parts, y: from.y + (point.y - from.y) * k / parts });
    }
    out.push(point);
  });
  return out;
}

/** Delarna av linjen där `keep` gäller, längre än `minLength`. */
function keptPieces(points: readonly Point[], keep: readonly boolean[], minLength: number): Point[][] {
  const pieces: Point[][] = [];
  let run: Point[] = [];
  points.forEach((point, i) => {
    if (keep[i]) { run.push(point); return; }
    if (run.length >= 2) pieces.push(run);
    run = [];
  });
  if (run.length >= 2) pieces.push(run);
  return pieces.filter(piece => lengthOf(piece) >= minLength);
}

const asLine = (object: Extract<MapObject, { kind: "line" }>, points: readonly Point[]): MapObject =>
  ({ ...object, path: points.map((point, i) => ({ type: i === 0 ? "M" as const : "L" as const, x: point.x, y: point.y })) });

/**
 * Linjerna klippta efter `keep` (punkt för punkt, var `step` mm): orörd när allt står kvar, borttagen när inget gör det.
 * `minLength` är kortaste bit som står kvar.
 */
function clipLines(rows: readonly CodedObject[], step: number, minLength: number,
  keepAt: (point: Point, direction: Point) => boolean, filter?: (keep: boolean[], points: readonly Point[]) => boolean[]): CleanPlan {
  const remove: string[] = [], replace: { key: string; objects: MapObject[] }[] = [];
  for (const row of rows) {
    const object = row.object;
    if (object.kind !== "line") continue;
    const parts = linesOf(object).map(line => densify(line, step));
    let changed = false;
    const objects: MapObject[] = [];
    for (const points of parts) {
      let keep = points.map((point, i) => {
        const a = points[Math.max(0, i - 1)]!, b = points[Math.min(points.length - 1, i + 1)]!;
        const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return keepAt(point, { x: (b.x - a.x) / length, y: (b.y - a.y) / length });
      });
      if (filter) keep = filter(keep, points);
      if (keep.every(Boolean)) { objects.push(asLine(object, points)); continue; }
      changed = true;
      objects.push(...keptPieces(points, keep, minLength).map(piece => asLine(object, piece)));
    }
    if (!changed) continue;
    if (objects.length === 0) remove.push(row.key); else replace.push({ key: row.key, objects });
  }
  return { remove, replace };
}

/** Andelen av ytan (punkter i ett rutnät inne i den) där `test` gäller. */
function shareOf(rings: readonly Ring[], test: (x: number, y: number) => boolean): number {
  const outer = rings[0]!, box = boxOf(outer);
  const spacing = Math.max(Math.sqrt(Math.max(ringArea(outer), 1e-6) / 200), 0.05);
  let total = 0, hits = 0;
  for (let x = box.minX + spacing / 2; x < box.maxX; x += spacing) for (let y = box.minY + spacing / 2; y < box.maxY; y += spacing) {
    if (!inRing(outer, x, y) || rings.slice(1).some(hole => inRing(hole, x, y))) continue;
    total += 1;
    if (test(x, y)) hits += 1;
  }
  if (total === 0) {
    const cx = outer.reduce((sum, p) => sum + p.x, 0) / outer.length, cy = outer.reduce((sum, p) => sum + p.y, 0) / outer.length;
    return test(cx, cy) ? 1 : 0;
  }
  return hits / total;
}

/**
 * Sankmark, diken och små bäckar i bebyggt (se överst). `water` är objekten som prövas (nummer 305–310 eller de som
 * anroparen valt, t.ex. bara laserns lager), `built` kartans och kandidaternas objekt; `extra` mer bebyggt (t.ex. kartans
 * egna ytor och kanter vid en inläsning). `metres` i terrängen, `scale` kartans skala.
 */
export function waterInBuiltPlan(water: readonly CodedObject[], built: readonly CodedObject[], scale: number, metres = SPRINT_BUILT_METRES,
  extra?: Shapes): CleanPlan {
  if (water.length === 0) return { remove: [], replace: [] };
  const distance = metres * 1000 / scale;
  const shapes = joinShapes(builtShapes(built), extra);
  if (shapes.polygons.length === 0 && shapes.lines.length === 0) return { remove: [], replace: [] };
  const index = new Proximity(shapes, distance);
  const remove: string[] = [];
  for (const row of water) {
    if (row.object.kind !== "area") continue;
    const rings = ringsOf(row.object);
    if (rings.length && shareOf(rings, (x, y) => index.near(x, y, distance)) >= 0.5) remove.push(row.key);
  }
  const lines = clipLines(water.filter(row => row.object.kind === "line"), Math.max(distance / 6, 0.1), 1, point => !index.near(point.x, point.y, distance));
  return { remove: [...remove, ...lines.remove], replace: lines.replace };
}

/**
 * Stigar i vägar (se överst). `roads` är vägarnas objekt (501 och 501.1), `extra` fler vägar. En sträcka längs en kant tas bort
 * först när den är minst `MIN_ALONG_MM` lång (ett kort stycke nära en kant är en stig som når fram till vägen).
 */
export function pathsInRoadsPlan(paths: readonly CodedObject[], roads: readonly CodedObject[], scale: number, extra?: Shapes): CleanPlan {
  if (paths.length === 0) return { remove: [], replace: [] };
  const mm = (metres: number) => metres * 1000 / scale;
  const side = mm(ROAD_SIDE_METRES), half = mm(ROAD_HALF_WIDTH_METRES);
  const shapes = joinShapes(roadShapes(roads), extra);
  if (shapes.polygons.length === 0 && shapes.lines.length === 0) return { remove: [], replace: [] };
  const index = new Proximity(shapes, half);
  const step = Math.max(mm(0.5), 0.05);
  const alongAt = new Map<Point, boolean>();
  return clipLines(paths, step, Math.max(mm(4), 0.3), (point, direction) => {
    if (index.inside(point.x, point.y)) return false;
    alongAt.set(point, index.along(point.x, point.y, direction.x, direction.y, side, half));
    return true;
  }, (keep, points) => {
    // Sträckor längs en kant tas bort när de är minst `MIN_ALONG_M` långa.
    const out = [...keep];
    let start = -1;
    const close = (end: number) => {
      if (start < 0) return;
      if (lengthOf(points.slice(start, end + 1)) >= mm(MIN_ALONG_M)) for (let i = start; i <= end; i += 1) out[i] = false;
      start = -1;
    };
    points.forEach((point, i) => { if (keep[i] && alongAt.get(point)) { if (start < 0) start = i; } else close(i - 1); });
    close(points.length - 1);
    return out;
  });
}
/** Kortaste sträcka längs en kant som tas bort (meter). */
const MIN_ALONG_M = 6;

/**
 * Slutna kantlinjer (501.1) som inte syns som en ö: mindre än `MIN_RING_MM2` eller smalare än `MIN_RING_WIDTH_MM` i medel
 * (2 × yta / omkrets) och högst `MAX_THIN_RING_MM` lång. Måtten i kartans mm (sprintnormens tryck); nycklarna.
 */
export const MIN_RING_MM2 = 0.5, MIN_RING_WIDTH_MM = 0.45, MAX_THIN_RING_MM = 3;
export function smallEdgeRingKeys(edges: readonly CodedObject[]): string[] {
  return edges.filter(row => {
    if (row.object.kind !== "line" || !isEdge(row.code)) return false;
    const lines = linesOf(row.object);
    if (lines.length !== 1) return false;
    const points = lines[0]!, first = points[0]!, last = points[points.length - 1]!;
    if (points.length < 4 || Math.hypot(first.x - last.x, first.y - last.y) > 0.02) return false;
    const area = ringArea(points), perimeter = lengthOf(points), box = boxOf(points);
    const size = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
    return area < MIN_RING_MM2 || (size <= MAX_THIN_RING_MM && 2 * area / perimeter < MIN_RING_WIDTH_MM);
  }).map(row => row.key);
}
