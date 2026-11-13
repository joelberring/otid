import type { SourceFeature } from "../vector-parse";
import { simplifyRing } from "./photo-interpret";

/**
 * Ägaren 2026-11-13 («strandlinjer blir väldigt hackiga», Ornö södra): vattnet kommer ur laserns 2 m-raster (geo-water.ts)
 * och dess kant är rutnätets trappsteg med enstaka uddar och vikar på en eller två rutor. Strandlinjen (`shoreLines`) dras
 * längs vattnets ringar, så ringarna jämnas ut innan: punkterna läggs tätt (var `spacing` meter) längs ringen, flyttas mot
 * ett gaussiskt vägt medel av grannarna längs ringen (`sigma` meter) och glesas sedan ut (Douglas–Peucker).
 *
 * Punkter på körningens yttre kant (`pinned`) flyttas inte, så att `shoreLines` fortfarande ser var vattnet är avskuret av
 * kanten. Små ringar (gölar, kobbar) jämnas mindre, så att de inte krymper bort.
 */
type Pair = [number, number];
export interface WaterSmoothing { readonly spacing: number; readonly sigma: number; readonly tolerance: number }
export const WATER_SMOOTHING: WaterSmoothing = { spacing: 1.5, sigma: 3.5, tolerance: 0.4 };

const perimeterOf = (ring: readonly (readonly [number, number])[]) =>
  ring.reduce((sum, point, i) => { const next = ring[(i + 1) % ring.length]!; return sum + Math.hypot(next[0] - point[0], next[1] - point[1]); }, 0);

/** Ringen med punkter var `spacing` meter (de ursprungliga hörnen som är fästa behålls). */
function resample(ring: readonly (readonly [number, number])[], spacing: number, pinned: (point: readonly [number, number]) => boolean): { point: Pair; fixed: boolean }[] {
  const out: { point: Pair; fixed: boolean }[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const fixedA = pinned(a), fixedB = pinned(b);
    out.push({ point: [a[0], a[1]], fixed: fixedA });
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.floor(length / spacing);
    // En sträcka längs kanten (båda ändarna fästa) får inga nya punkter: den ska ligga kvar rak.
    if (fixedA && fixedB) continue;
    for (let s = 1; s < steps; s += 1) {
      const t = s / steps;
      out.push({ point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], fixed: false });
    }
  }
  return out;
}

/** En sluten ring utjämnad (öppen form: första punkten upprepas inte). */
export function smoothRing(ring: readonly (readonly [number, number])[], pinned: (point: readonly [number, number]) => boolean = () => false,
  settings: WaterSmoothing = WATER_SMOOTHING): Pair[] {
  const open = ring.length > 3 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? ring.slice(0, -1) : ring;
  if (open.length < 4) return open.map(([x, y]) => [x, y]);
  const perimeter = perimeterOf(open);
  // En liten ring (omkrets under 20 sigma) jämnas med en mindre sigma så att den behåller sin storlek (radien krymper
  // med ungefär e^(−(σ/R)²/2), alltså högst 5 % med σ = omkretsen / 20).
  const sigma = Math.min(settings.sigma, perimeter / 20);
  if (sigma < settings.spacing / 2) return open.map(([x, y]) => [x, y]);
  const points = resample(open, settings.spacing, pinned), n = points.length;
  const reach = Math.min(Math.floor(n / 2) - 1, Math.ceil(3 * sigma / settings.spacing));
  const weights = Array.from({ length: reach + 1 }, (_, k) => Math.exp(-((k * settings.spacing) ** 2) / (2 * sigma * sigma)));
  const smoothed = points.map(({ point, fixed }, i): Pair => {
    if (fixed || reach < 1) return point;
    let x = point[0] * weights[0]!, y = point[1] * weights[0]!, total = weights[0]!;
    for (let k = 1; k <= reach; k += 1) {
      for (const j of [(i + k) % n, (i - k + n) % n]) {
        x += points[j]!.point[0] * weights[k]!; y += points[j]!.point[1] * weights[k]!; total += weights[k]!;
      }
    }
    return [x / total, y / total];
  });
  // Douglas–Peucker på en sluten ring: delad vid punkten längst från den första, i två halvor som förenklas var för sig.
  const first = smoothed[0]!;
  let far = 1;
  for (let i = 1; i < n; i += 1) if (Math.hypot(smoothed[i]![0] - first[0], smoothed[i]![1] - first[1]) > Math.hypot(smoothed[far]![0] - first[0], smoothed[far]![1] - first[1])) far = i;
  const a = simplifyRing(smoothed.slice(0, far + 1), settings.tolerance), b = simplifyRing([...smoothed.slice(far), first], settings.tolerance);
  return [...a, ...b.slice(1, -1)].map(([x, y]) => [x, y]);
}

/**
 * Lagret `vatten` utjämnat. `extent` är körningens yttre ruta: punkter inom 1,5 m från den räknas som kanten och flyttas inte.
 */
export function smoothWater(features: readonly SourceFeature[], extent: { minX: number; minY: number; maxX: number; maxY: number } | undefined,
  settings: WaterSmoothing = WATER_SMOOTHING): SourceFeature[] {
  const EDGE_M = 1.5;
  const pinned = ([x, y]: readonly [number, number]) => !!extent && (Math.abs(x - extent.minX) <= EDGE_M || Math.abs(x - extent.maxX) <= EDGE_M
    || Math.abs(y - extent.minY) <= EDGE_M || Math.abs(y - extent.maxY) <= EDGE_M);
  return features.map(feature => {
    if (feature.layer !== "vatten") return feature;
    const geometry = feature.geometry;
    if (geometry.kind === "area") return { ...feature, geometry: { kind: "area", rings: geometry.rings.map(ring => smoothRing(ring, pinned, settings)).filter(ring => ring.length >= 3) } };
    if (geometry.kind === "line" && geometry.closed) return { ...feature, geometry: { kind: "line", closed: true, points: smoothRing(geometry.points, pinned, settings) } };
    return feature;
  });
}
