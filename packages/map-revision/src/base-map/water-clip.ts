import type { SourceFeature } from "../index";

/**
 * Ägaren 2026-11-12 («höjdkurvor åker ibland ut i vattnet»): lasern har ingen mark över vatten, så Karttapullautin drar
 * kurvorna rakt över sjön mellan stränderna. Här klipps linjerna mot grundkartans vattenytor: varje linje provas var
 * `STEP_M` meter, och bara bitarna på land blir kvar. Bitar kortare än `MIN_PIECE_M` (stumpar i strandkanten) tas bort.
 */
const STEP_M = 2, MIN_PIECE_M = 10;
type Point = readonly [number, number];

/**
 * Vattnet som ett raster (`CELL_M` meter per cell) över linjernas utbredning: att prova varje provpunkt mot stora sjö- och
 * havsytor med tusentals brytpunkter låste sidan i minuter på ett helt kartblad (ägaren 2026-11-12: «vid större jobb verkar
 * detta läge tungt»). Varje yta fylls rad för rad (jämn–udda över alla ringar, så öar blir hål).
 */
const CELL_M = 2, MAX_CELLS = 40_000_000;
interface WaterMask { readonly inside: (x: number, y: number) => boolean }

function waterMask(features: readonly SourceFeature[], isWater: (layer: string) => boolean, box: { minX: number; minY: number; maxX: number; maxY: number }): WaterMask | undefined {
  const polygons = features.flatMap(feature => {
    if (!isWater(feature.layer)) return [];
    const rings = feature.geometry.kind === "area" ? feature.geometry.rings : feature.geometry.kind === "line" && feature.geometry.closed ? [feature.geometry.points] : [];
    return rings[0] && rings[0].length >= 3 ? [rings] : [];
  });
  if (polygons.length === 0) return undefined;
  let cell = CELL_M;
  while (((box.maxX - box.minX) / cell + 1) * ((box.maxY - box.minY) / cell + 1) > MAX_CELLS) cell *= 2;
  const columns = Math.max(1, Math.ceil((box.maxX - box.minX) / cell) + 1), rows = Math.max(1, Math.ceil((box.maxY - box.minY) / cell) + 1);
  const mask = new Uint8Array(columns * rows);
  for (const rings of polygons) {
    let minY = Infinity, maxY = -Infinity;
    for (const [, y] of rings[0]!) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const first = Math.max(0, Math.floor((minY - box.minY) / cell)), last = Math.min(rows - 1, Math.ceil((maxY - box.minY) / cell));
    // Kanterna per rad, så att varje rad bara ser sina egna.
    const crossings: number[][] = Array.from({ length: last - first + 1 }, () => []);
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
        if (yi === yj) continue;
        const low = Math.min(yi, yj), high = Math.max(yi, yj);
        const from = Math.max(first, Math.ceil((low - box.minY) / cell - 0.5)), to = Math.min(last, Math.floor((high - box.minY) / cell - 0.5));
        for (let row = from; row <= to; row += 1) {
          const y = box.minY + (row + 0.5) * cell;
          if (y < low || y >= high) continue;
          crossings[row - first]!.push(xi + (xj - xi) * (y - yi) / (yj - yi));
        }
      }
    }
    for (let row = first; row <= last; row += 1) {
      const xs = crossings[row - first]!.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil((xs[k]! - box.minX) / cell - 0.5)), to = Math.min(columns - 1, Math.floor((xs[k + 1]! - box.minX) / cell - 0.5));
        if (to >= from) mask.fill(1, row * columns + from, row * columns + to + 1);
      }
    }
  }
  return { inside: (x, y) => {
    const column = Math.floor((x - box.minX) / cell), row = Math.floor((y - box.minY) / cell);
    return column >= 0 && row >= 0 && column < columns && row < rows && mask[row * columns + column] === 1;
  } };
}
const lengthOf = (points: readonly Point[]) => points.reduce((sum, point, i) => i === 0 ? 0 : sum + Math.hypot(point[0] - points[i - 1]![0], point[1] - points[i - 1]![1]), 0);

/** Linjerna som `clipped` väljer, utan delarna i vattnet. Annat lämnas orört. Koordinaterna är meter. */
export function linesOutsideWater(features: readonly SourceFeature[], clipped: (feature: SourceFeature) => boolean,
  isWater: (layer: string) => boolean = layer => /^vatten$/i.test(layer)): { features: SourceFeature[]; cut: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const feature of features) {
    if (feature.geometry.kind !== "line" || !clipped(feature)) continue;
    for (const [x, y] of feature.geometry.points) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  }
  const water = Number.isFinite(minX) ? waterMask(features, isWater, { minX, minY, maxX, maxY }) : undefined;
  if (!water) return { features: [...features], cut: 0 };
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
          if (water.inside(x, y)) add([x, y], false);
          else if (piece.length === 0) piece.push([x, y]);
          else shore = [x, y];
        }
      }
      add(point, !water.inside(point[0], point[1]));
    }
    if (piece.length >= 2) pieces.push(piece);
    if (!wet) return [feature];
    cut += 1;
    return pieces.filter(part => lengthOf(part) >= MIN_PIECE_M).map(part => ({ layer: feature.layer, geometry: { kind: "line" as const, points: part, closed: false } }));
  });
  return { features: out, cut };
}
