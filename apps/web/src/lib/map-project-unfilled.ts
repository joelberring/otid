import { flattenPath, type Point } from "@o-tid/map-file";
import type { Box } from "@o-tid/map-revision";
import type { Face } from "@o-tid/map-revision/faces";
import { FILL_FRAME, FILL_GAP_M, fillFaces, isBoundary, type FillInput } from "./map-project-fill-area";

/**
 * K8b V5 (ägaren 2026-11-21): Visa ofyllda rutor. Samma ytmotor som Magisk fyll (`fillFaces`): kartans linjer och ytkanter i det
 * synliga utsnittet delar marken i rutor, och de rutor som ingen yta täcker visas (röd skraffering) och räknas. Rutor utanför
 * kartans område (projektets kartområde om det finns) och rutor som når kartans yttre kant räknas inte. Räknas i Workern.
 */
/** Största utsnittet (m i terrängen åt varje håll); större = zooma in. */
export const UNFILLED_MAX_M = 600;
/** Flest sträckor i utsnittet; fler = zooma in. */
const MAX_SEGMENTS = 60_000;
/** Mindre rutor än så här (m²) räknas inte (glipor mellan linjer som ligger nästan på varandra). */
const MIN_M2 = 1;
/** Flest rutor som skickas till sidan för skrafferingen (alla räknas). */
const MAX_CELLS = 400;

export interface UnfilledQuery {
  /** Det synliga utsnittet i kartans mm. */
  readonly box: Box;
  readonly hidden: readonly string[];
  /** Projektets kartområde (ringar i kartans mm), om det finns. */
  readonly area?: readonly (readonly Point[])[] | undefined;
}

export interface UnfilledCell { readonly rings: Point[][]; readonly at: Point; readonly areaM2: number }

export type UnfilledResult =
  | { readonly status: "done"; readonly cells: UnfilledCell[]; readonly count: number }
  /** Utsnittet är för stort eller har för många sträckor: zooma in. */
  | { readonly status: "zoomIn" };

/** Punkten inuti ringarna (jämn–udda: ytterkanten och hålen), mitt i den bredaste biten längs några vågräta linjer. */
export function interiorPoint(rings: readonly (readonly Point[])[]): Point | undefined {
  const outer = rings[0];
  if (!outer || outer.length < 3) return undefined;
  let minY = Infinity, maxY = -Infinity;
  for (const point of outer) { minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
  let best: { at: Point; width: number } | undefined;
  for (const fraction of [0.5, 0.31, 0.69, 0.13, 0.87]) {
    const y = minY + (maxY - minY) * fraction + (maxY - minY) * 1e-7;
    const xs: number[] = [];
    for (const ring of rings) for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      if ((a.y > y) !== (b.y > y)) xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const width = xs[i + 1]! - xs[i]!;
      if (width > 0 && (!best || width > best.width)) best = { at: { x: (xs[i]! + xs[i + 1]!) / 2, y }, width };
    }
  }
  return best?.at;
}

/** Ligger punkten i ringarna (jämn–udda)? */
export function insideRings(rings: readonly (readonly Point[])[], p: Point): boolean {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const overlaps = (a: Box, b: Box) => a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;

/** Rutorna i utsnittet som ingen yta täcker. `bounds` är kartans yttre gräns (objektens ruta). */
export function findUnfilled(input: FillInput & { readonly bounds?: Box | undefined }, query: UnfilledQuery): UnfilledResult {
  const mmPerM = 1000 / input.scale, limit = UNFILLED_MAX_M * mmPerM;
  const view = query.box;
  if (view.maxX - view.minX > limit * 1.001 || view.maxY - view.minY > limit * 1.001) return { status: "zoomIn" };
  // Kartans yttre kant med lite marginal: utanför den ligger alltid en ruta mellan de yttersta linjerna och utsnittets ram.
  const tolerance = FILL_GAP_M * mmPerM, margin = tolerance * 4;
  const bounds = input.bounds && { minX: input.bounds.minX - margin, minY: input.bounds.minY - margin, maxX: input.bounds.maxX + margin, maxY: input.bounds.maxY + margin };
  const box = bounds ? { minX: Math.max(view.minX, bounds.minX), minY: Math.max(view.minY, bounds.minY), maxX: Math.min(view.maxX, bounds.maxX),
    maxY: Math.min(view.maxY, bounds.maxY) } : view;
  if (box.maxX <= box.minX || box.maxY <= box.minY) return { status: "done", cells: [], count: 0 };
  const hidden = new Set(query.hidden);
  const faces = fillFaces(input, hidden, box, tolerance, MAX_SEGMENTS);
  if (!faces) return { status: "zoomIn" };
  // Ytorna som kan täcka en ruta: synliga ytobjekt vars kanter är gränser (samma regel som rutorna byggs med).
  const covers: { box: Box; rings: Point[][] }[] = [];
  input.objects.forEach((object, index) => {
    if (object.kind !== "area" || !isBoundary(input.symbols.get(object.symbol), hidden)) return;
    const bounds = input.boxes[index];
    if (bounds && !overlaps(bounds, box)) return;
    covers.push({ box: bounds ?? box, rings: object.rings.flatMap(ring => flattenPath(ring)) });
  });
  const eps = 1e-6 * Math.max(1, limit);
  /** Rutan går ut till ramen på en sida som ligger utanför kartans yttersta objekt (marken runt kartan). */
  const atMapEdge = (face: Face) => !!bounds && face.sources.includes(FILL_FRAME) && face.outer.some(point =>
    (box.minX === bounds.minX && Math.abs(point.x - box.minX) < eps) || (box.maxX === bounds.maxX && Math.abs(point.x - box.maxX) < eps)
    || (box.minY === bounds.minY && Math.abs(point.y - box.minY) < eps) || (box.maxY === bounds.maxY && Math.abs(point.y - box.maxY) < eps));
  const cells: UnfilledCell[] = [];
  for (const face of faces) {
    const areaM2 = face.area / (mmPerM * mmPerM);
    if (areaM2 < MIN_M2 || atMapEdge(face)) continue;
    const rings = [face.outer, ...face.holes].map(ring => ring.map(point => ({ x: point.x, y: point.y })));
    const at = interiorPoint(rings);
    if (!at) continue;
    if (query.area?.length && !insideRings(query.area, at)) continue;
    if (covers.some(cover => at.x >= cover.box.minX && at.x <= cover.box.maxX && at.y >= cover.box.minY && at.y <= cover.box.maxY && insideRings(cover.rings, at))) continue;
    cells.push({ rings, at, areaM2 });
  }
  // I läsordning: uppifrån (y uppåt) och från vänster.
  cells.sort((a, b) => b.at.y - a.at.y || a.at.x - b.at.x);
  return { status: "done", cells: cells.slice(0, MAX_CELLS), count: cells.length };
}
