import type { MapObject, Point } from "@o-tid/map-file";

/**
 * Ägaren 2026-11-11 («karttas körning gick på hela rutan, den blev inte beskuren»): kandidaterna klipps mot kartans område
 * (polygonen, inte bara dess rektangel). Punkter utanför tas bort; linjer delas där de korsar kanten; ytor klipps med
 * Sutherland–Hodgman mot varje kant (exakt för ett konvext område, en god nog närmning för ett svagt konkavt). Kartans mm.
 */
type Ring = readonly Point[];

export function insidePolygon(polygon: readonly Ring[], point: Point): boolean {
  let hit = false;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i]!, b = ring[j]!;
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
    }
  }
  return hit;
}

/** Var sträckan a–b korsar polygonens kanter (andelar 0–1 längs sträckan, sorterade). */
function crossings(polygon: readonly Ring[], a: Point, b: Point): number[] {
  const out: number[] = [];
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const c = ring[j]!, d = ring[i]!;
      const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
      if (denominator === 0) continue;
      const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator;
      const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denominator;
      // Halvöppen kant: en sträcka genom ett hörn räknas en gång.
      if (t > 0 && t < 1 && u >= 0 && u < 1) out.push(t);
    }
  }
  return out.sort((x, y) => x - y);
}

/** En linje som bitarna inne i polygonen. */
export function clipLineToPolygon(points: readonly Point[], polygon: readonly Ring[]): Point[][] {
  const pieces: Point[][] = [];
  let current: Point[] = [];
  const at = (a: Point, b: Point, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  if (points.length && insidePolygon(polygon, points[0]!)) current.push(points[0]!);
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!, b = points[index]!;
    let inside = insidePolygon(polygon, at(a, b, 1e-9));
    for (const t of crossings(polygon, a, b)) {
      const cut = at(a, b, t);
      if (inside) { current.push(cut); if (current.length >= 2) pieces.push(current); current = []; }
      else current = [cut];
      inside = !inside;
    }
    if (inside) current.push(b);
  }
  if (current.length >= 2) pieces.push(current);
  return pieces;
}

/** En ring klippt mot polygonens ytterkant. */
export function clipRingToPolygon(ring: Ring, outer: Ring): Point[] {
  const signed = outer.reduce((sum, a, i) => { const b = outer[(i + 1) % outer.length]!; return sum + a.x * b.y - b.x * a.y; }, 0);
  const clip = signed >= 0 ? outer : [...outer].reverse();
  let output: Point[] = [...ring];
  for (let i = 0; i < clip.length && output.length; i += 1) {
    const c = clip[i]!, d = clip[(i + 1) % clip.length]!;
    const side = (p: Point) => (d.x - c.x) * (p.y - c.y) - (d.y - c.y) * (p.x - c.x) >= 0;
    const cut = (p: Point, q: Point) => {
      const a1 = d.y - c.y, b1 = c.x - d.x, c1 = a1 * c.x + b1 * c.y;
      const a2 = q.y - p.y, b2 = p.x - q.x, c2 = a2 * p.x + b2 * p.y;
      const det = a1 * b2 - a2 * b1;
      return det === 0 ? q : { x: (b2 * c1 - b1 * c2) / det, y: (a1 * c2 - a2 * c1) / det };
    };
    const input = output;
    output = [];
    for (let k = 0; k < input.length; k += 1) {
      const current = input[k]!, previous = input[(k + input.length - 1) % input.length]!;
      if (side(current)) { if (!side(previous)) output.push(cut(previous, current)); output.push(current); }
      else if (side(previous)) output.push(cut(previous, current));
    }
  }
  return output;
}

const pointsOf = (path: readonly { x: number; y: number }[]): Point[] => path.map(command => ({ x: command.x, y: command.y }));
const pathOf = (points: readonly Point[]) => points.map((point, index) => ({ type: index === 0 ? "M" as const : "L" as const, x: point.x, y: point.y }));

/** Objekten klippta mot polygonen; kurvor (C) räknas på sina ändpunkter. */
export function clipObjectsToPolygon(objects: readonly MapObject[], polygon: readonly Ring[]): { objects: MapObject[]; clipped: number; outside: number } {
  const out: MapObject[] = [];
  let clipped = 0, outside = 0;
  const outer = polygon[0];
  if (!outer || outer.length < 3) return { objects: [...objects], clipped, outside };
  for (const object of objects) {
    if (object.kind === "point" || object.kind === "text") {
      if (insidePolygon(polygon, object.at)) out.push(object); else outside += 1;
    } else if (object.kind === "line") {
      const points = pointsOf(object.path);
      if (points.every(point => insidePolygon(polygon, point))) { out.push(object); continue; }
      const pieces = clipLineToPolygon(points, polygon);
      if (!pieces.length) { outside += 1; continue; }
      clipped += 1;
      for (const piece of pieces) out.push({ ...object, path: pathOf(piece) });
    } else {
      const rings = object.rings.map(ring => pointsOf(ring));
      if (rings.every(ring => ring.every(point => insidePolygon(polygon, point)))) { out.push(object); continue; }
      const kept = rings.map(ring => clipRingToPolygon(ring, outer)).filter(ring => ring.length >= 3);
      if (!kept.length || (rings[0] && clipRingToPolygon(rings[0], outer).length < 3)) { outside += 1; continue; }
      clipped += 1;
      out.push({ ...object, rings: kept.map(ring => pathOf([...ring, ring[0]!])) });
    }
  }
  return { objects: out, clipped, outside };
}
