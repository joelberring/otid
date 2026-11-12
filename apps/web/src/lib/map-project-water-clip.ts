import type { SourceFeature } from "@o-tid/map-revision";

/**
 * Ägaren 2026-11-12 («höjdkurvor åker ibland ut i vattnet»): lasern har ingen mark över vatten, så Karttapullautin drar
 * kurvorna rakt över sjön mellan stränderna. Här klipps linjerna mot grundkartans vattenytor: varje linje provas var
 * `STEP_M` meter, och bara bitarna på land blir kvar. Bitar kortare än `MIN_PIECE_M` (stumpar i strandkanten) tas bort.
 */
const STEP_M = 2, MIN_PIECE_M = 10;
type Point = readonly [number, number];
interface Water { readonly rings: readonly (readonly Point[])[]; readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

const inRing = (ring: readonly Point[], x: number, y: number) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
/** I vattnet: i ytterringen men inte i ett hål (en ö). */
const inWater = (waters: readonly Water[], x: number, y: number) => waters.some(water => x >= water.minX && x <= water.maxX && y >= water.minY && y <= water.maxY
  && inRing(water.rings[0]!, x, y) && !water.rings.slice(1).some(hole => inRing(hole, x, y)));
const lengthOf = (points: readonly Point[]) => points.reduce((sum, point, i) => i === 0 ? 0 : sum + Math.hypot(point[0] - points[i - 1]![0], point[1] - points[i - 1]![1]), 0);

function waterOf(features: readonly SourceFeature[], isWater: (layer: string) => boolean): Water[] {
  return features.flatMap(feature => {
    if (!isWater(feature.layer)) return [];
    const rings = feature.geometry.kind === "area" ? feature.geometry.rings : feature.geometry.kind === "line" && feature.geometry.closed ? [feature.geometry.points] : [];
    const outer = rings[0];
    if (!outer || outer.length < 3) return [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of outer) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    return [{ rings, minX, minY, maxX, maxY }];
  });
}

/** Linjerna som `clipped` väljer, utan delarna i vattnet. Annat lämnas orört. Koordinaterna är meter. */
export function linesOutsideWater(features: readonly SourceFeature[], clipped: (feature: SourceFeature) => boolean,
  isWater: (layer: string) => boolean = layer => /^vatten$/i.test(layer)): { features: SourceFeature[]; cut: number } {
  const waters = waterOf(features, isWater);
  if (waters.length === 0) return { features: [...features], cut: 0 };
  let cut = 0;
  const out = features.flatMap((feature): SourceFeature[] => {
    const geometry = feature.geometry;
    if (geometry.kind !== "line" || !clipped(feature)) return [feature];
    const points = geometry.closed && geometry.points.length ? [...geometry.points, geometry.points[0]!] : geometry.points;
    const pieces: Point[][] = [];
    let piece: Point[] = [], wet = false, shore: Point | undefined;
    const add = (point: Point, dry: boolean) => {
      if (dry) { piece.push(point); shore = undefined; return; }
      // Den sista provpunkten på land avslutar biten vid stranden.
      if (shore && piece.length) piece.push(shore);
      wet = true; shore = undefined;
      if (piece.length >= 2) pieces.push(piece);
      piece = [];
    };
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i]!;
      if (i > 0) {
        const from = points[i - 1]!, span = Math.hypot(point[0] - from[0], point[1] - from[1]), steps = Math.floor(span / STEP_M);
        for (let k = 1; k < steps; k += 1) {
          const x = from[0] + (point[0] - from[0]) * k / steps, y = from[1] + (point[1] - from[1]) * k / steps;
          // Provpunkterna på land behövs inte i linjen; bara de i vattnet bryter den.
          if (inWater(waters, x, y)) add([x, y], false);
          else if (piece.length === 0) piece.push([x, y]);
          else shore = [x, y];
        }
      }
      add(point, !inWater(waters, point[0], point[1]));
    }
    if (piece.length >= 2) pieces.push(piece);
    if (!wet) return [feature];
    cut += 1;
    return pieces.filter(part => lengthOf(part) >= MIN_PIECE_M).map(part => ({ layer: feature.layer, geometry: { kind: "line" as const, points: part, closed: false } }));
  });
  return { features: out, cut };
}
